"""Upload pipeline: sniff magic bytes, guard against decompression bombs, strip EXIF/GPS by re-encoding,
write WebP + AVIF at 640/1280/2048, and compute a blurhash."""
import asyncio
import io
import secrets
from typing import Any

import blurhash

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()
from ..config import cfg  # noqa: E402
Image.MAX_IMAGE_PIXELS = 100_000_000  # decompression-bomb guard (raises DecompressionBombError above 2x)
MAX_FLAT_PIXELS = 40_000_000  # PNG / WebP / HEIC can't be decoded smaller, so they are capped lower

WIDTHS = (640, 1280, 2048)
_gate = asyncio.Semaphore(1)  # one image job at a time: keeps peak memory low on small servers


async def run_limited(fn, *args):
    async with _gate:
        return await asyncio.to_thread(fn, *args)
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"}


class UploadError(ValueError):
    pass


def sniff(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:8] == b"ftyp" and data[8:12] in HEIC_BRANDS:
        return "heic"
    return None  # includes SVG, GIF, PDF, HTML ...: all rejected


def new_prefix() -> str:
    return "m/" + secrets.token_urlsafe(18).replace("-", "a").replace("_", "b")


def _watermark(img: Image.Image, text: str) -> Image.Image:
    img = img.convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    size = max(14, img.width // 40)
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(layer)
    w = d.textlength(text, font=font)
    d.text((img.width - w - size, img.height - size * 2), text, font=font, fill=(255, 255, 255, 70))
    return Image.alpha_composite(img, layer)


def _encode(img: Image.Image, fmt: str, width: int) -> bytes | None:
    im = img if img.width <= width else img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    try:
        if fmt == "webp":
            im.save(buf, "WEBP", quality=82, method=4)
        else:
            im.save(buf, "AVIF", quality=55, speed=8)
    except Exception:  # noqa: BLE001  (AVIF encoder may be missing)
        return None
    return buf.getvalue()


def make_variants(img: Image.Image, wm_text: str | None = None) -> tuple[dict[str, tuple[bytes, str]], dict[str, Any]]:
    """Returns ({filename: (bytes, content_type)}, variants-json). Alpha is preserved (drawings)."""
    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    img = img.convert("RGBA" if has_alpha else "RGB")
    if wm_text:
        img = _watermark(img, wm_text)
        if not has_alpha:
            img = img.convert("RGB")
    files: dict[str, tuple[bytes, str]] = {}
    variants: dict[str, list[int]] = {"webp": [], "avif": []}
    widths = sorted({min(w, img.width) for w in WIDTHS})
    if img.width < WIDTHS[0]:
        widths = [img.width]
    for w in widths:
        for fmt in (("webp", "avif") if cfg.image_avif else ("webp",)):
            data = _encode(img, fmt, w)
            if data:
                files[f"{w}.{fmt}"] = (data, f"image/{fmt}")
                variants[fmt].append(w)
    variants = {k: v for k, v in variants.items() if v}
    return files, variants


def hash_of(img: Image.Image) -> str | None:
    try:
        t = img.convert("RGB")
        t.thumbnail((48, 48))
        return blurhash.encode(t, 4, 3)
    except Exception:  # noqa: BLE001
        return None


def process_image(data: bytes, wm_text: str | None = None) -> dict[str, Any]:
    kind = sniff(data)
    if not kind:
        raise UploadError("Unsupported file. Use JPG, PNG, WebP or HEIC.")
    try:
        img = Image.open(io.BytesIO(data))
        # Phone photos can be 50 megapixels. We never publish more than 2048 px wide, so JPEGs are decoded at a reduced
        # size (a big saving in memory and time). Other formats cannot be reduced while decoding, so they are capped.
        if kind == "jpeg":
            img.draft("RGB", (2560, 2560))
        elif img.width * img.height > MAX_FLAT_PIXELS:
            raise UploadError("That picture has too many pixels (over 40 megapixels). Please resize it and try again.")
        img.load()
    except UploadError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise UploadError("That image is too large.")
    except Exception:  # noqa: BLE001
        raise UploadError("That file could not be read as an image.")
    img = ImageOps.exif_transpose(img)  # honour rotation, then drop all metadata by re-encoding
    img.info.pop("exif", None)
    files, variants = make_variants(img, wm_text)
    if not files:
        raise UploadError("Could not process the image.")
    return {"width": img.width, "height": img.height, "blurhash": hash_of(img), "files": files, "variants": variants}
