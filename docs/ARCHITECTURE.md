# Architecture

## The shape of the system

```
browser ──HTTP──▶ Fastify API ──▶ Postgres
   │                  │
   │                  └──▶ git repository per workspace (on disk)
   │
   └──WebSocket──▶ Hocuspocus ──▶ Yjs document ──▶ Postgres (binary state)
                                        │
                                        └──▶ markdown ──▶ git commit
```

A document has two representations and they serve different jobs.

**Yjs is the live truth.** Every keystroke is a CRDT update, broadcast to the other
editors and merged without conflicts. Hocuspocus persists the encoded state to
`document_states.state` a couple of seconds after activity settles.

**Markdown is the durable record.** On the same save the server converts the Yjs
document to markdown and, after a longer debounce, commits it to the workspace's git
repository as a real `.md` file. That is what version history reads, and what you get
if you ever clone the repository and walk away from Collaby.

## Why the editor package is shared

Turning a Yjs document into markdown means walking a ProseMirror document, which means
the server needs the exact schema the browser used. `packages/editor` exports
`createBaseExtensions()` and `collabySchema()`, and both apps build from it.

`packages/editor/src/markdown` holds the two halves of the conversion:

- `serializer.ts` maps ProseMirror nodes to markdown. Things markdown has no syntax for
  (colours, underline, image crops, block alignment) are written as the inline HTML that
  markdown allows, so a file stays readable in any other editor.
- `parser.ts` plus `markdown-it-collaby.ts` read it back. The markdown-it plugin adds the
  pieces markdown-it does not do on its own: task lists, Obsidian callouts, mermaid
  fences, table cell alignment, and the inline HTML the serializer emits.

`packages/editor/test/markdown.test.ts` asserts that every construct survives a round
trip and that a second pass is byte-identical. Anything that fails that test would
silently lose formatting on the way into git.

## Permissions

One ordered scale, used for both workspaces and documents:

```
viewer < commenter < editor < admin < owner
```

`packages/shared/src/roles.ts` maps each capability to the lowest role that has it, so
frontend and backend answer permission questions the same way.

A user's role on a document is the **highest** of:

1. their workspace role (owner, or their `workspace_members` row),
2. any `document_permissions` grant on the document **or any of its ancestors**, which is
   how sharing a folder shares everything inside it,
3. a share link, if one was presented.

The ancestor walk is a recursive CTE in `apps/server/src/access/resolve.ts`.

Read-only is enforced on the server, not just in the UI: `onAuthenticate` in the
collaboration server sets `connectionConfig.readOnly` when the role is below editor, so a
viewer's Yjs updates are rejected at the socket.

## Authentication

Three ways in, one session model behind them.

- **Password** with Argon2id.
- **Passkeys**, discoverable so no username is needed. The label exists only to tell
  entries apart in the account list.
- **Single sign-on** through any OpenID Connect provider, optional. Collaby reads the
  provider's discovery document to find its endpoints, uses the authorization code flow
  with PKCE where the provider advertises support, and verifies the returned ID token
  against the provider's JWKS, checking issuer, audience and the nonce it sent.

Password sign-in can be followed by a TOTP challenge. Recovery codes are single use and
stored as hashes.

**Tokens.** The access token is a short-lived HS256 JWT carrying the user id and the
session id. The refresh token is opaque, lives in an httpOnly cookie scoped to
`/api/auth`, and is stored only as a SHA-256 hash.

Every refresh rotates the token in place, keeping the same session row so the device
keeps its identity in the account settings list. The previous hash is kept: if it is ever
presented again, that is a stolen token being replayed, and every session for that account
is revoked.

Because rotation is destructive, the browser client funnels all refreshes through a single
in-flight promise so parallel requests cannot race each other into a false theft alarm.

An external identity is stored as the pair the OIDC spec makes unique: `oauth_accounts`
holds the provider's issuer URL alongside the subject claim, rather than a fixed provider
name. Swapping identity providers therefore cannot make two different people collide on
the same subject string.

## Storage

| Table                                                               | Holds                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `users`, `sessions`, `passkeys`, `recovery_codes`, `oauth_accounts` | accounts and how they sign in                                               |
| `workspaces`, `workspace_members`                                   | who belongs where                                                           |
| `documents`                                                         | the page tree, one row per page                                             |
| `document_states`                                                   | the Yjs binary state and the last exported markdown                         |
| `document_permissions`, `share_links`                               | sharing                                                                     |
| `comments`                                                          | threads anchored to a text range                                            |
| `document_revisions`                                                | a searchable mirror of the git log                                          |
| `assets`                                                            | uploaded images                                                             |
| `user_preferences`                                                  | the workspace and page each person last had open, so `/` returns them there |
| `cli_device_requests`                                               | pending CLI sign-ins, their user code and the scope once approved           |

Files on disk under `DATA_DIR`:

```
data/repos/<workspaceId>/...      one git repository per workspace
data/assets/<workspaceId>/...     uploaded images
```

## Comments

A comment thread is anchored by a `commentAnchor` mark carrying a random id, stored in the
document itself. The thread body lives in Postgres keyed by that same id. That split keeps
comment text out of the CRDT (so it is not merged or versioned) while the highlight moves
with the text as people edit around it.

## Search

Two generated `tsvector` columns carry the index: `documents.title_vector` over the page
title and `document_states.search_vector` over the exported markdown. Both are `STORED`
generated columns with a GIN index, so they stay in step with the data without triggers
and without a separate indexing job. Because the markdown column is written on every
save, search is current within seconds of the last edit.

Queries are built as prefix terms (`deploy` becomes `deploy:*`) joined with `AND`, which
is what people expect while typing. Title matches are weighted four times heavier than
body matches. `ts_headline` returns the relevant passage, and the server splits it into
matched and unmatched segments before sending it, so the browser never has to parse
highlight markers.

The configuration is `simple`, meaning no stemming and no stopword list. That keeps the
index language neutral, which matters for a tool that will hold German and English pages
side by side. The trade-off is that `laufen` will not find `läuft`.

Results are restricted the same way document access is: pages in workspaces you belong
to, plus pages shared with you directly and everything beneath them.

## Reordering

The sidebar sends `{ parentId, index }` to `POST /api/documents/:id/move`. The server
rebuilds the sibling list without the moved page, splices it in at `index`, and renumbers
every sibling in one transaction, so positions stay dense and unambiguous. When the parent
changes, the old parent's remaining children are renumbered too, and the page's markdown
file is moved to its new path in git as a rename.

Dragging is built on pointer events rather than HTML5 drag and drop, because the latter
does nothing on touch. A mouse starts a drag after six pixels of movement; a finger starts
one after a long press on the grip handle, which is always visible on devices without
hover. Dropping on the upper or lower quarter of a row reorders, dropping on the middle
nests, and a collapsed folder opens if you hover over it. Drops onto the page itself or
onto one of its own descendants are refused in the browser and again on the server.

## CLI sync

### Signing in

`collaby setup` uses a device authorization flow. The CLI asks the server for a pair of
codes: a long device code it keeps to itself, and a short user code it shows in the
terminal and in the link it opens. The browser page shows the same user code and the
machine name, so a person can tell they are approving their own terminal and not a link
someone sent them. The CLI waits on `POST /api/cli/token`, which the server holds open for
up to 25 seconds at a time, so approval reaches the terminal within about a second without
the CLI hammering the server.

The token is issued when the CLI collects it, not when the person approves. That way the
refresh token never has to be stored in plain text anywhere on the server.

### A token that can only read

A CLI session is a row in `sessions` with `kind = 'cli'` and the approved scope. Its access
token is signed for a different audience (`collaby-cli`), so every normal route rejects it
outright, and CLI routes reject browser tokens the same way. Refresh is split too:
`/api/auth/refresh` only rotates browser sessions and `/api/cli/refresh` only CLI sessions.
Without that split, a refresh token read out of `.collaby/credentials.json` could be traded
at the browser endpoint for a token with full account access.

CLI refresh tokens rotate like browser ones, with two differences. A replayed token within
60 seconds of a rotation is treated as a crash between the server rotating and the CLI
saving the new token, and rotates again instead of failing. Outside that window, reuse ends
only that CLI session rather than every session on the account.

### What a session can see

The scope is either every workspace the person belongs to, including ones they join later,
or a list of workspaces and folders. It is resolved on every request and intersected with
current membership, so leaving a workspace also removes it from the CLI.

A page's local path starts at the highest point that was granted: the workspace root when
the whole workspace is shared, the folder itself when only a folder is. Names of folders
above a granted folder never appear, since they were not shared.

### Keeping up to date

`GET /api/cli/manifest` lists every page in scope with its path and a hash of its markdown,
plus a cursor derived from all of them. The CLI downloads only pages whose hash changed,
keeps the raw markdown in `.collaby/cache`, and renders the files from that cache. Rendering
locally matters because a page's file can change without its own content changing: when a
page it links to is renamed, the relative link has to be rewritten.

`collaby watch` long polls `GET /api/cli/wait` with its cursor. The server compares the
cursor about every second and a half and answers as soon as it differs, so changes arrive a
few seconds after the editor saves them.

## Deployment

`docker-compose.yml` runs Postgres, the API, the web app and Caddy. Caddy puts everything
on one origin: `/api/*` and `/collab` go to the API, the rest to Next.js.

That single origin is not just tidiness. It makes the refresh cookie same-site, it makes
the WebAuthn relying party id match without configuration, and it means the browser bundle
needs no build-time API URL, so the same image runs against any domain.
