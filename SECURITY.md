# Security policy

## Reporting a vulnerability

**Please don't open a public issue for security problems.**
A public report gives people a working attack before there's a fix.

Report it privately with GitHub's **Report a vulnerability** button on the Security tab:
https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new

Only the maintainers can see a private report.
You can also get there from the editor with **Help > Report a Security Issue**.

Backup contact (for people without a GitHub account): _to be added_.
Until then, please use the private advisory form above.

## Supported versions

Only the live site (https://latex.prestonhager.com/) and the `main` branch get security fixes.
There are no release branches, so fixes land on `main` and deploy from there.

## In scope

For example:

- XSS, or script getting out of the sandboxed preview iframe.
- Peer messages that crash, take over, or wipe someone else's project.
- Document content leaking outside the WebRTC connection, or to anyone without the room link.
- Leaking or misusing Google Drive access tokens.
- Anything in the build or the GitHub Pages workflow that could ship bad code.

## Out of scope

- Bugs in third-party services, such as Google, public WebTorrent trackers, or TURN providers.
  Please report those to the service.
- Missing best-practice headers or settings without a working attack.
- The known TURN credential exposure, tracked in [#24](https://github.com/PrestonHager/LaTeXCollaborativeEditor/issues/24).

## What to include

- Steps to reproduce, ideally the smallest LaTeX project or set of peer messages that shows it.
- The browser and its version, and the OS.
- How bad you think it is, and what an attacker would need (for example, the room link).

Don't include real document contents, room links to other people's rooms, or tokens.

## What to expect

- A reply within 7 days saying we got the report.
- Updates as we confirm it and work on a fix.
- Credit in the published advisory, if you want it.

## Disclosure

We fix the problem, publish a GitHub security advisory, and then the details go public.
Please keep the details private until the fix is out or 90 days have passed since your report, whichever comes first.

## Safe harbor

Good-faith testing on your own rooms and projects is fine, and we won't take action against it.
Don't test against other people's rooms, their Google Drive data, or their accounts, and don't run tests that degrade the service for others.
