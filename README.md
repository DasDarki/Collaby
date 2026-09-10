<img src="logo.png" alt="Collaby" width="96">

# Collaby

A collaborative markdown drive. Obsidian-style editing, Google Drive-style sharing,
and a real git history underneath every page.

The name comes from **collab**oration and lu**llaby**, which is also where the
interface gets its look: a dark, quiet workspace built for writing at night.

## What it does

- **Write markdown, see the result.** Type `# `, `- `, `> `, `- [ ] ` or ` ```mermaid ` and the
  syntax disappears as it renders, the way Obsidian does. Everything is also reachable
  from the toolbar.
- **Edit together.** Live cursors, a viewer list, and a rail on the right edge of the
  page showing where each collaborator is working.
- **Share what you choose.** A page or a whole workspace, with a person or a link,
  as viewer, commenter or editor. Folder permissions carry down to child pages.
- **Keep every version.** Each workspace is a git repository. Pages are committed as
  real `.md` files a short while after you stop typing, and any version can be restored.
- **Find anything.** Press `Ctrl`/`Cmd` + `K` to search titles and page contents across
  every page you can open, with the matching passage shown in the result.
- **Rearrange by dragging.** Drag a page in the sidebar to reorder it or to nest it under
  another. Works with a mouse and with a long press on touch.

## Editor features

|          |                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------- |
| Text     | bold, italic, underline, strikethrough, inline code, text colour, background colour, highlight |
| Blocks   | headings 1-6, paragraphs, quotes, dividers, code blocks with syntax highlighting               |
| Lists    | bullet, numbered, task lists (`- [ ]`)                                                         |
| Callouts | Obsidian syntax (`> [!WARNING] Title`), 13 kinds, collapsible                                  |
| Tables   | with per-column alignment                                                                      |
| Diagrams | Mermaid, rendered live                                                                         |
| Images   | upload, drag to resize, crop, align, wrap text around them                                     |
| Links    | external links open in a new tab after a warning, internal links autocomplete with `[[`        |
| Comments | anchored to a text range, with replies and resolve                                             |
| Contents | a collapsible outline of the headings that follows your scrolling                              |
| Layout   | left, centre, right and justified alignment                                                    |

## Getting started

Requirements: Node 22+, pnpm 10, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env          # then fill in the two secrets
pnpm infra:up                 # starts Postgres
pnpm db:migrate
pnpm dev                      # web on :3000, API on :4000
```

Open http://localhost:3000 and create an account. You get a personal workspace right away.

## Single sign-on

Collaby speaks plain OpenID Connect, so any compliant provider works: Auth0, Authentik,
Keycloak, Zitadel, Logto, Google, and others. Point it at an issuer and it reads the rest
from that provider's discovery document.

```bash
OIDC_ISSUER=https://your-tenant.eu.auth0.com
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_PROVIDER_NAME=Auth0        # the button reads "Continue with Auth0"
```

Whatever the provider, register Collaby as a **regular web application** (one that keeps a
client secret, not a single-page app) and allow exactly this callback URL:

```
https://your-collaby-domain/api/auth/oidc/callback
```

Nothing else needs allowing. Collaby redirects the browser from its own server, so the
provider never sees a JavaScript origin from us.

**Auth0 in particular:** create an application of type _Regular Web Application_, put the
callback URL above into _Allowed Callback URLs_, and copy Domain, Client ID and Client
Secret into the three variables. `OIDC_ISSUER` is the domain with `https://` in front; a
trailing slash is fine either way. _Allowed Web Origins_ can stay empty.

One thing worth knowing before you plan around it: Auth0's social connections use shared
development keys only for testing. To offer "sign in with Google" through Auth0 in
production you still have to create your own Google OAuth client. Auth0's own database
logins, passwordless email, and connections like GitHub have no such requirement.

Collaby serves its own artwork, which saves uploading anything for the provider's login
screen: `/logo.png` is the full 640px logo and `/logo-mark.png` the square 512px mark, both
under your own domain.

The first sign-on creates an account and a personal workspace. Later sign-ons are matched
on the provider's issuer and subject. If an account with the same address already exists,
the two are linked, and its password keeps working. Collaby refuses a sign-on whose email
the provider has not verified, so nobody can take over an account by claiming its address.

## Deploying

Everything is served from one domain through a small Caddy container, which keeps cookies
same-site and makes passkeys work without extra configuration.

```bash
cp .env.example .env
# set POSTGRES_PASSWORD, JWT_SECRET, SECRET_ENCRYPTION_KEY and PUBLIC_WEB_URL
docker compose up -d --build
```

That publishes the proxy on port 8080; set `PUBLIC_PORT` to move it. The API applies its
own database migrations on start.

Two named volumes hold state worth backing up: `collaby-postgres` and `collaby-data`
(git repositories and uploaded images).

### Coolify

Point it at this repository, choose _Docker Compose_, and set `POSTGRES_PASSWORD`,
`JWT_SECRET`, `SECRET_ENCRYPTION_KEY` and `PUBLIC_WEB_URL`. Give the `proxy` service your
domain and port `80`.

No host port is involved: Coolify's own proxy reaches the container over the Docker
network, so `docker-compose.yml` only exposes 80 rather than binding it. The host
binding lives in `docker-compose.override.yml`, which Compose merges automatically for a
plain `docker compose up` but which Coolify ignores, because it passes an explicit `-f`.

The Caddy configuration is baked into the proxy image rather than bind mounted, for a
related reason: Coolify runs compose from a different directory than the one it checks the
repository out into, so a relative bind mount of a file would be created there as an empty
directory and the container would refuse to start. Edit `deploy/Caddyfile` and redeploy to
change it.

## Layout

```
apps/web        Next.js app: editor, sharing, account settings
apps/server     Fastify API, Hocuspocus collaboration server, git versioning
packages/editor Tiptap schema and the markdown parser/serializer, shared by both
packages/db     Drizzle schema and migrations
packages/shared Roles, capabilities and request contracts
```

`packages/editor` is deliberately shared: the browser and the server build the same
ProseMirror schema, which is how the server can turn a live Yjs document into the
markdown it commits to git.

## Commands

|                                      |                                          |
| ------------------------------------ | ---------------------------------------- |
| `pnpm dev`                           | run web and API together                 |
| `pnpm build`                         | build everything                         |
| `pnpm typecheck`                     | typecheck every package                  |
| `pnpm --filter @collaby/editor test` | markdown round-trip tests                |
| `pnpm db:generate`                   | generate a migration from schema changes |
| `pnpm db:migrate`                    | apply migrations                         |
| `pnpm infra:up` / `pnpm infra:down`  | local Postgres                           |

## Security notes

- Passwords are hashed with Argon2id. TOTP secrets are encrypted at rest with AES-256-GCM.
- Access tokens are short-lived JWTs; refresh tokens are opaque, rotated on every use,
  and stored only as hashes. Reusing an old refresh token revokes the whole account's
  sessions.
- Every device is its own session, visible and revocable from account settings.
- Uploaded images are served from unguessable URLs rather than per-request authorization,
  because the browser cannot attach a token to an `<img>` tag. Treat an image URL as a
  capability: anyone holding it can view that one file.

## Known gaps

- Invitations only work for people who already have an account; no email is sent.
- A comment anchor stays in the list when the text it points at is deleted.
- Search matches whole words and prefixes (`deploy` finds `deployment`), not substrings
  in the middle of a word.

## License

AGPL-3.0-only.
