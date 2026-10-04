"""Rebuilds api/app/data/blocklist.txt from the open word lists (download them first, see api/app/data/NOTICE.md).
Usage: python scripts/build_blocklist.py <folder with en.txt hi.txt ct_en.txt ct_hi.txt>
Sections: 'core' = matched aggressively (inside longer words, misspelt, spaced out);
          'extended' = matched only as whole words; 'ignore' = ordinary words that appear in the sources."""
import re, sys

src = sys.argv[1]
def load(f): return [l.strip().lower() for l in open(f"{src}/{f}", encoding="utf-8") if l.strip() and not l.startswith("#")]
def ok(w):
    w = re.sub(r"\s+", " ", w)
    if len(w.replace(" ", "")) < 3: return None
    if re.search(r"[^a-z0-9 ]", w) and not re.search(r"[ऀ-ॿ஀-௿]", w): return None
    return w
def clean(ws): return [x for x in (ok(w) for w in ws) if x]

ct_en, ld_en, ct_hi, ld_hi = set(clean(load("ct_en.txt"))), set(clean(load("en.txt"))), clean(load("ct_hi.txt")), clean(load("hi.txt"))

devanagari = "चूतिया चुतिया चूतिये चुतिये चूत चुत भोसड़ी भोसड़ीके भोसडीके भोसड़ा भोसडा मादरचोद मादरचोदो बहनचोद बेहनचोद बहनचोदो गांडू गान्डू गांड गान्ड गांडफट लौड़ा लोड़ा लौडा लंड लण्ड लवड़ा रंडी रण्डी रांड हरामी हरामखोर हरामजादा हरामजादी हरामज़ादा हरामज़ादे कमीना कमीनी कमीने कुतिया चोदू चोद चोदना चुदाई चुदक्कड़ बकचोद बकचोदी झाटू झांट झाँट भड़वा भड़वे भड़वी भडवा छिनाल छिनार हिजड़ा बलात्कार बलात्कारी".split()
tamil_script = "ஓத்த ஓத்தா ஒத்தா ஓக்க புண்டை தேவடியா தேவிடியா தேவுடியா சுன்னி சூத்து சூத்தை கூதி உம்பு ஊம்பு மயிரு மயிர் நாயே தாயோளி தாயோலி பன்னாடை ஒம்மாள ஓம்மால ஒம்மாளே".split()
tanglish = "otha ottha oththa othaa otta punda pundai pundamavane pundamone pundaimavane pundaiyan pundakku pundaichi thevidiya thevdiya thevudiya thevidiyapaiyan thevidiyamavan devidiya devdiya sunni sunniya soothu sootha soodhu koothi koodhi kuthi kuthichi koothichi ommala omala ommaala umbu oombu oombhu mairu myiru mayiru mayir myir naye nayae naaye thayoli thaayoli thaaoli thayolli pannada pannadai gommala gommaala".split()
threats = ["kill you","kill yourself","kill him","kill her","go die","hope you die","die in a fire","i will find you","maar dunga","maar dalunga","jaan se maar","jaan se maar dunga","kolluven","konnuruven","shoot you","bomb you","acid attack"]

# ordinary words that appear in the sources but should not flag a comment on their own
ignore = set("""abuse babes blacks enlargement illegal jerry licking marijuana nasty penetration screw spank stroke strokes sucking terror terrorist torture
valium virgin words naked lingerie ho hell damn crap bum butt barf chug bong dong dink fart gob hoar
teste tested trigger rigger""".split())

core = (ct_en & ld_en) | set(ct_hi) | set(ld_hi) | set(devanagari) | set(tamil_script) | set(tanglish) | set(threats)
core -= ignore
extended = (ct_en | ld_en) - core - ignore

def section(name, words): return f"## {name} ({len(words)})\n" + "\n".join(sorted(words)) + "\n"
header = """# Built-in abusive-word list for comment screening: see NOTICE.md for sources. One entry per line; "#" lines are comments.
# Sections: core = matched aggressively (inside longer words, misspelt, spaced out); extended = whole words only;
# ignore = ordinary words found in the sources that should never flag a comment by themselves.
# Matching is deliberately generous (app/services/moderation.py): flagging a harmless comment only sends it to the owner's
# review queue, while missing an abusive one would not. Rebuild with scripts/build_blocklist.py.
"""
out = header + "\n" + section("core", core) + "\n" + section("extended", extended) + "\n" + section("ignore", ignore)
open("api/app/data/blocklist.txt", "w", encoding="utf-8", newline="\n").write(out)
print("core", len(core), "| extended", len(extended), "| ignore", len(ignore))
