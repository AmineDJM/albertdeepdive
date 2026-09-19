# Where the files actually go

Traced from the code, not from memory. Every claim below names the file that makes it true.

## One upload, end to end

A photograph dropped into the Library goes through `ingestMedia`
(`src/server/media/ingest.ts`), which does all of this in one pass, synchronously, in the request
that received the bytes:

1. `getStorage()` resolves the adapter once (`src/server/storage/index.ts`).
2. The original is written at `media/<assetId>/original.<ext>` — `storage.put`, never `fs`.
3. Every variant (thumbnail, web, print) is produced in the same pass and written at
   `media/<assetId>/<kind>.<format>`.
4. Only then are the `media_assets` and `media_variants` rows inserted, with `storage_key`,
   dimensions, size, mime type and a `sha256` of the original.

So there is **no cross-container handoff for thumbnails**: variants are not a worker's job, and a
web dyno and a worker dyno cannot disagree about where a file went, because the job runner runs
in-process and calls the same `getStorage()`.

Reading is the mirror image. `mediaUrls` (`src/server/media/urls.ts`) looks up the variant row and
asks the adapter for a **signed URL at read time**. Nothing expiring is ever stored in the
database — the database holds the key, and the URL is minted when somebody needs it.

## Which storage, and who decides

`storageConfig()` (`src/server/storage/config.ts`) resolves, in order:

1. **Object storage**, if the console has a bucket, an access key and a secret saved. The console
   wins over the environment, so connecting a bucket takes effect without a redeploy.
2. Otherwise `STORAGE_PROVIDER=s3` with environment credentials, for installs that inject secrets at
   deploy time.
3. Otherwise **the local disk**, which is right for a laptop and wrong for any host that replaces
   its container.

Supabase Storage is reached over the S3 protocol, through `S3StorageAdapter`
(`src/server/storage/s3.ts`) with `forcePathStyle` — Supabase requires it, as do R2, Scaleway and
MinIO. `normaliseEndpoint` accepts either a project URL or an S3 endpoint and completes the former
to `…/storage/v1/s3`, because both get pasted into the same field by people who are right to think
they are the same thing.

The fields are on the storage card in **Admin → Providers → Object storage**. Credentials live in
the integration settings table, never in `render.yaml`, and are never sent to a browser.

## The abstraction holds

`StorageAdapter` (`src/server/storage/types.ts`) is `put`, `get`, `delete`, `exists`, `list`,
`getSignedUrl` and an optional `localPath`. Two implementations: `LocalStorageAdapter` and
`S3StorageAdapter`.

Nothing outside `src/server/storage/local.ts` writes a durable byte to the filesystem — no
`fs.writeFile`, no `createWriteStream` anywhere else under `src/server`. Every durable file in the
product goes through the adapter.

`localPath` has four callers and every one of them degrades rather than breaks when there is no
disk:

| Caller | Without a disk |
| --- | --- |
| `document-builder.ts` | `src.print.path` is null; the renderer never uses it |
| `pdf.ts` | reads bytes with `storage.get(key)` and embeds them as data URIs — provider-agnostic |
| `creative/service.ts` | a generated ground with no mtime is treated as old; the grace period does not apply |
| `api/storage/[…key]/route.ts` | falls through to `storage.get(key)` and streams the buffer |

So **PDF and print export work identically on object storage**. That is worth stating plainly,
because it is the thing a switch of provider would most plausibly have broken.

## Keys and isolation

```
media/<assetId>/original.<ext>          media_assets.organization_id
media/<assetId>/<variant>.<format>      …the same asset
attachments/<submissionId>/<id>.<ext>   submissions → editions.organization_id
publications/<editionId>/<versionId>/…  editions.organization_id
creative/<packId>/…                     creative_packs.organization_id
audio/<narrationId>/…                   narrations.organization_id
voices/<cloneId>/…                      voice_clones.organization_id
health/…                                nobody — the storage health check
tmp/…                                   nobody
```

The keys are flat and id-based rather than `workspaces/<id>/…`, and that is deliberate.
`organizationOwning` (`src/server/storage/ownership.ts`) resolves the owner of any key from the
database by prefix, and `/api/storage/[...key]` refuses a key whose owner is not the caller's
workspace. Ownership is therefore a fact in Postgres, not a string in a path: guessing a path gains
an attacker nothing, and a file cannot be mis-filed into the wrong tenant's prefix by a bug in a key
builder. Re-keying would also invalidate every object already stored and every link already
published, for no security gained. `tests/integration/storage-access.test.ts` holds the isolation
to it in both directions, including signed links and platform staff.

## What can go wrong, and how to find out

A row holds a key; a browser asks for the key; whether the bytes exist is a **third fact**, and it
is the one that broke a deployed library where every thumbnail came back empty while the database
and the console both looked healthy.

**Admin → Storage** answers it:

- **Does it work** — writes a small object under `health/`, reads it back byte for byte, signs a
  URL, deletes it, and times the round trip. A bucket that accepts a write and refuses a read is
  configured *and* broken; only trying says so.
- **Is everything still there** — `auditStorage()` lists what the bucket holds under `media/` and
  `publications/` and compares it, both ways, with every key the database expects: missing objects
  (a broken picture somebody is looking at now), attributed per workspace, and orphans (storage
  nobody points at). One listing per prefix, not one request per row.
- **Are the bytes right** — `verifyChecksums()` compares a sample of originals against the `sha256`
  recorded at ingest, because a present object is not necessarily the right object.
- **Move the disk into the bucket** — `migrateLocalObjectsToBucket()` copies every expected key from
  the local disk to the connected bucket, verifies each copy by reading it back and, where a digest
  was recorded, by digest. **The keys do not change**, so no database row is rewritten and no
  published link breaks. Nothing is deleted from the disk; reclaiming it is a separate decision.
  A dry run reports what would happen. It refuses outright when no bucket is connected.

`tests/integration/storage-integrity.test.ts` reproduces the failure: it removes the object from
underneath a seeded asset and asserts that the audit names that key, attributes it to the right
workspace, and that a signed URL is still handed out for it meanwhile — which is exactly the broken
thumbnail.

## Known gaps

- **Deleting an asset does not delete its objects.** The Library archives rather than deletes, and
  nothing removes the original or its variants from storage. The audit's orphan list is the input a
  cleanup would need; the cleanup itself is not written.
- **No periodic health check.** The round trip runs when somebody presses the button. There is no
  schedule, no stored history, and therefore no "last healthy" or failure count over time.
- **Generated creative grounds** under `creative/generated/…` are shared by content address and
  owned by nobody; they are pruned by their own job, not by this audit.
