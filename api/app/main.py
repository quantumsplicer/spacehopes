import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import cfg
from .deps import limiter
from .routers import public, studio, studio_auth
from .scheduler import start_scheduler
from .services import storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await storage.ensure_bucket()
    except Exception as e:  # noqa: BLE001
        logging.getLogger("startup").warning("storage not ready yet: %s", type(e).__name__)
    sched = start_scheduler()
    yield
    sched.shutdown(wait=False)


app = FastAPI(
    title="Space hopes API", lifespan=lifespan,
    docs_url="/api/docs" if cfg.is_dev else None, redoc_url=None,
    openapi_url="/api/openapi.json" if cfg.is_dev else None,
)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def too_many(request: Request, exc: RateLimitExceeded):
    return JSONResponse({"detail": "Too many requests. Please slow down a little."}, status_code=429)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Cap request bodies (uploads are streamed and capped again in the handlers).
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > cfg.max_upload_bytes + 12 * 1024 * 1024:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    resp.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    if request.url.path.startswith("/api/v1/studio") or request.url.path.startswith("/api/v1/reader"):
        resp.headers["Cache-Control"] = "no-store"
    if not cfg.is_dev:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
    return resp


@app.get("/api/health")
async def health():
    return {"ok": True}


app.include_router(public.router, prefix="/api/v1")
app.include_router(studio_auth.router, prefix="/api/v1/studio/auth")
app.include_router(studio.router, prefix="/api/v1/studio")
