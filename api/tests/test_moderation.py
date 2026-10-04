import time

import pytest

from app.services.moderation import looks_abusive

ABUSIVE = [
    "fuck you", "F U C K", "f.u.c.k", "fuuuuuck", "fvck", "sh1t", "$hit", "@ss hole", "f*ck", "sh**", "fuckyou",
    "you are a motherfucker", "pathetic bastard", "stupid b1tch", "dick head", "whoreee",
    "chutiya", "chutiyaa", "chutiyaaa", "ch00tiya", "madarchod", "m a d a r c h o d", "behenchod", "bhosdike", "bhosdi ke", "gaandu",
    "चूतिया", "मादरचोद", "हरामी",
    "ommala", "ooooombu", "thevidiya", "thevdiyaa", "punda mavane", "சூத்து", "மயிரு",
    "i will kill you", "maar dunga tujhe",
]
HARMLESS = [
    "Hello, I really enjoyed this thoughtful essay on public service.",
    "The class on Assam culture was wonderful.",
    "I assume the policy will pass next month.",
    "Please assess the impact on rural schools.",
    "The therapist recommended a long walk.",
    "Scunthorpe is a town in England.",
    "Nayeem is a very kind colleague.",
    "My grandmother makes the best coconut chutney.",
    "Thank you for sharing your hopes for the district.",
    "A selection of books about rejection and protection.",
]


@pytest.mark.parametrize("text", ABUSIVE)
def test_abusive_text_is_flagged_even_when_disguised(text):
    assert looks_abusive(text), text


@pytest.mark.parametrize("text", HARMLESS)
def test_ordinary_sentences_are_not_flagged(text):
    assert not looks_abusive(text), text


def test_empty_and_long_input_are_safe_and_fast():
    assert not looks_abusive("") and not looks_abusive("   ")
    t = time.time()
    for _ in range(10):
        looks_abusive("The quick brown fox jumps over the lazy dog. " * 60)
    assert (time.time() - t) / 10 < 0.3
