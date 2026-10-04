# Owner's guide

Plain-language help for running your site. Nothing here needs code.

## Signing in

Go to `your-site/studio` and enter your **login ID** and **password**. The starting login is `admin` / `admin@123`: **change it the first time** in *Settings > Security > Login and password* (type the current password, then a new one of at least 12 characters with a mix of letters, numbers and symbols; you can also pick a different login ID). Changing it signs you out of every other device.

Every sign-in is recorded and emailed to you. If you see one you did not expect, change your password at once. After a few wrong guesses the form makes you wait (5 seconds, then 10, 20, up to 5 minutes), and the server enforces the same waits, so nobody can guess their way in. If you forget the password, ask whoever runs the server to reset it (`docs/SECURITY.md`, "Resetting a password").

## Writing

* **New thought**: one to four sentences. Add **one drawing or up to four photos**. Every picture needs a short **alt text** (what it shows, for people who cannot see it). Publishing is blocked until it is filled in.
* **New blog**: title, a one-line standfirst, then the body. Type `/` (or tap **+**) to add a **Drawing**, **Image**, **Gallery**, **Heading**, **Quote**, **Divider** or **Video** (a YouTube link). Click a picture to Replace, Crop, make it Wide or Remove it.
* Your work **saves itself every few seconds**. If you edit in two places at once the Studio warns you instead of overwriting.
* **Preview** shows it as readers will see it. **Schedule** publishes at a time you pick. **Publish** goes live now. *Version history* (side panel) brings back an earlier draft.
* Photos lose their location data automatically.

## Drawing

On an iPad, use the Apple Pencil. Two fingers move and zoom the page; tap with two fingers to undo, three to redo. Turn on **Pencil only** if your palm leaves marks. Tap a tool again for its options (the eraser has *pixel* and *stroke*; shapes can straighten a line when you hold still). Layers are on the right. **Add to post** puts the drawing into the post; open it again any time to keep drawing. See `docs/DRAWING.md` for everything.

## Comments

*Studio > Comments* (the number is how many are waiting). For each one: **Approve** (shows on the site), **Reply** (posted as "Author"), **Hide** (kept, not shown), **Block** (the person cannot comment again). Comments flagged in red have several links, or contain abusive words (the site checks English, Hindi and Tamil spellings, including disguised ones like `f*ck`). It errs on the side of flagging, so a few harmless comments will land here too. Flagged comments never appear without you. Comments are plain text, so links are not clickable.

*Settings* decides who can comment: **anyone with just a name** (default) or **signed-in readers** (they get a one-time code by email; only their name is shown). You can also turn review on or off.

## Your numbers (Overview)

* **Visitors**: how many times the site was opened. One per person per browsing session.
* **Readers**: how many times a blog was opened. One per blog per person per session. (Thoughts are read in the feed, so they are not counted.)
* **Read rate**: readers divided by visitors.
* **New subscribers**: people who confirmed their email.
Counted without cookies or personal data. Search engines and other bots are filtered out.

## Subscribers and messages

People confirm their email before they are added, and every email has an unsubscribe link. *Studio > Subscribers* shows them (and messages from the contact form); the owner can export the confirmed list as a CSV. Each new post is emailed to confirmed subscribers.

## What the site shows about you

The header wordmark is the site name (**Space hopes**, changeable in *Settings > Site name*). The About page shows only the quote and the name under it (*Settings > Name shown under the About quote*, currently "Saravanan Murugan, IAS"). The Contact page shows the social links you add in Settings (LinkedIn is set up). There is no photo, biography or address.

**Copying is turned off** on posts by default (Settings). It stops casual copying only. Anyone can still take a screenshot.

## If something goes wrong

* *The site is down*: ask whoever runs the server to run `docker compose up -d`.
* *Restore from backup*: `make restore` on the server (nightly backups are kept for 14 days).
* *Locked out by wrong guesses*: wait up to 15 minutes, then try again with the right password.
