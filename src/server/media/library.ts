import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { NotFoundError } from "@/lib/action-result";
import { CONSENT_TEXTS } from "@/lib/constants";
import { contentTokens } from "@/lib/editorial/text";
import { DUPLICATE_THRESHOLD, hammingDistance, SIMILAR_THRESHOLD } from "./hash";
import { mediaUrls } from "./urls";

/* Pure constants (kinds, roles, thresholds, flag explanations) live in ./constants so client
   components can import them; they are re-exported here for server code. */
export * from "./constants";
import {
  LOW_QUALITY_THRESHOLD,
  MEDIA_KINDS,
  PRINT_READY_MIN_WIDTH,
  RIGHTS_STATUSES,
  type MediaSort,
  type RightsStatus,
} from "./constants";

/* ──────────────────────────────────────────────────────────────────────────
   listMedia
   ────────────────────────────────────────────────────────────────────────── */

export type MediaListFilters = {
  q?: string;
  rights?: string;
  kind?: string;
  quality?: "low" | "ok" | string;
  duplicates?: "only" | string;
  storyId?: string;
  unused?: "true" | string;
  contributorId?: string;
  /** "true" lists archived assets only; otherwise archived assets are hidden. */
  archived?: "true" | string;
  sort?: MediaSort | string;
  page?: number | string;
  pageSize?: number | string;
};

export type MediaStoryLink = {
  id: string;
  title: string;
  status: string;
  role: string;
  sortOrder: number;
};

export type MediaListRow = {
  id: string;
  editionId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  format: string | null;
  aspectRatio: number | null;
  orientation: string | null;
  dominantColour: string | null;
  qualityScore: number | null;
  qualityFlags: string[];
  caption: string | null;
  altText: string | null;
  photographer: string | null;
  credit: string | null;
  rightsStatus: RightsStatus;
  rightsNote: string | null;
  aiDescription: string | null;
  aiTags: string[];
  kind: string;
  duplicateOfId: string | null;
  similarityGroup: string | null;
  isArchived: boolean;
  createdAt: Date;
  submissionId: string | null;
  submissionTitle: string | null;
  contributorId: string | null;
  contributorName: string | null;
  uploadedByName: string | null;
  thumbUrl: string | null;
  webUrl: string | null;
  stories: MediaStoryLink[];
  /** Number of assets sharing this asset's similarity group (including itself); 0 when not grouped. */
  duplicateGroupSize: number;
  /** Number of assets marked as duplicates of this one. */
  duplicatesOfThis: number;
};

export type MediaFacets = {
  rights: Record<RightsStatus, number>;
  kind: Record<string, number>;
  flags: Record<string, number>;
};

export type MediaListResult = {
  rows: MediaListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  facets: MediaFacets;
};

function toInt(value: number | string | undefined, fallback: number, min: number, max: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (n === undefined || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const unusedCondition = () =>
  sql`not exists (select 1 from ${s.storyMedia} sm where sm.media_asset_id = ${s.mediaAssets.id})
      and not exists (select 1 from ${s.businessDeepDives} b where ${s.mediaAssets.id} in (b.logo_asset_id, b.team_photo_asset_id, b.dashboard_asset_id, b.diagram_asset_id))
      and not exists (select 1 from ${s.editions} e where e.cover_media_asset_id = ${s.mediaAssets.id})`;

function scopeCondition(editionId: string | null, archived: boolean) {
  return and(
    editionId ? eq(s.mediaAssets.editionId, editionId) : undefined,
    eq(s.mediaAssets.isArchived, archived),
  );
}

function filterConditions(filters: MediaListFilters): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(s.mediaAssets.fileName, like),
        ilike(s.mediaAssets.caption, like),
        ilike(s.mediaAssets.aiDescription, like),
        ilike(s.mediaAssets.altText, like),
        ilike(s.mediaAssets.photographer, like),
        ilike(s.mediaAssets.credit, like),
        sql`array_to_string(${s.mediaAssets.aiTags}, ' ') ilike ${like}`,
      ),
    );
  }
  if (filters.rights && (RIGHTS_STATUSES as readonly string[]).includes(filters.rights)) {
    conditions.push(eq(s.mediaAssets.rightsStatus, filters.rights as RightsStatus));
  }
  if (filters.kind && (MEDIA_KINDS as readonly string[]).includes(filters.kind)) {
    conditions.push(eq(s.mediaAssets.kind, filters.kind));
  }
  if (filters.quality === "low")
    conditions.push(sql`coalesce(${s.mediaAssets.qualityScore}, 0) < ${LOW_QUALITY_THRESHOLD}`);
  if (filters.quality === "ok")
    conditions.push(sql`coalesce(${s.mediaAssets.qualityScore}, 0) >= ${LOW_QUALITY_THRESHOLD}`);
  if (filters.duplicates === "only") {
    conditions.push(
      or(isNotNull(s.mediaAssets.duplicateOfId), isNotNull(s.mediaAssets.similarityGroup)),
    );
  }
  if (filters.storyId) {
    conditions.push(
      inArray(
        s.mediaAssets.id,
        db
          .select({ id: s.storyMedia.mediaAssetId })
          .from(s.storyMedia)
          .where(eq(s.storyMedia.storyId, filters.storyId)),
      ),
    );
  }
  if (filters.unused === "true") conditions.push(unusedCondition());
  if (filters.contributorId)
    conditions.push(eq(s.mediaAssets.uploadedByContributorId, filters.contributorId));
  return conditions;
}

function orderFor(sort: string | undefined): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(s.mediaAssets.createdAt), asc(s.mediaAssets.id)];
    case "quality":
      return [sql`${s.mediaAssets.qualityScore} desc nulls last`, desc(s.mediaAssets.createdAt)];
    case "size":
      return [desc(s.mediaAssets.sizeBytes), desc(s.mediaAssets.createdAt)];
    case "name":
      return [asc(s.mediaAssets.fileName), desc(s.mediaAssets.createdAt)];
    default:
      return [desc(s.mediaAssets.createdAt), desc(s.mediaAssets.id)];
  }
}

/** Story links, contributor / submission / uploader names and URLs for a set of asset ids. */
async function hydrateRows(assets: (typeof s.mediaAssets.$inferSelect)[]): Promise<MediaListRow[]> {
  if (!assets.length) return [];
  const ids = assets.map((a) => a.id);
  const contributorIds = [
    ...new Set(assets.map((a) => a.uploadedByContributorId).filter((x): x is string => !!x)),
  ];
  const submissionIds = [
    ...new Set(assets.map((a) => a.submissionId).filter((x): x is string => !!x)),
  ];
  const userIds = [
    ...new Set(assets.map((a) => a.uploadedByUserId).filter((x): x is string => !!x)),
  ];
  const groups = [...new Set(assets.map((a) => a.similarityGroup).filter((x): x is string => !!x))];

  const [links, contributors, submissions, users, groupSizes, dupCounts, thumbs, webs] =
    await Promise.all([
      db
        .select({
          assetId: s.storyMedia.mediaAssetId,
          id: s.stories.id,
          title: s.stories.title,
          status: s.stories.status,
          role: s.storyMedia.role,
          sortOrder: s.storyMedia.sortOrder,
        })
        .from(s.storyMedia)
        .innerJoin(s.stories, eq(s.stories.id, s.storyMedia.storyId))
        .where(inArray(s.storyMedia.mediaAssetId, ids)),
      contributorIds.length
        ? db
            .select({
              id: s.contributors.id,
              firstName: s.contributors.firstName,
              lastName: s.contributors.lastName,
            })
            .from(s.contributors)
            .where(inArray(s.contributors.id, contributorIds))
        : [],
      submissionIds.length
        ? db
            .select({ id: s.submissions.id, title: s.submissions.title })
            .from(s.submissions)
            .where(inArray(s.submissions.id, submissionIds))
        : [],
      userIds.length
        ? db
            .select({ id: s.users.id, name: s.users.name })
            .from(s.users)
            .where(inArray(s.users.id, userIds))
        : [],
      groups.length
        ? db
            .select({ group: s.mediaAssets.similarityGroup, n: sql<number>`count(*)` })
            .from(s.mediaAssets)
            .where(inArray(s.mediaAssets.similarityGroup, groups))
            .groupBy(s.mediaAssets.similarityGroup)
        : [],
      db
        .select({ of: s.mediaAssets.duplicateOfId, n: sql<number>`count(*)` })
        .from(s.mediaAssets)
        .where(inArray(s.mediaAssets.duplicateOfId, ids))
        .groupBy(s.mediaAssets.duplicateOfId),
      mediaUrls(ids, "THUMBNAIL"),
      mediaUrls(ids, "WEB"),
    ]);

  const linksByAsset = new Map<string, MediaStoryLink[]>();
  for (const l of links) {
    const list = linksByAsset.get(l.assetId) ?? [];
    list.push({ id: l.id, title: l.title, status: l.status, role: l.role, sortOrder: l.sortOrder });
    linksByAsset.set(l.assetId, list);
  }
  const contributorName = new Map(contributors.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const submissionTitle = new Map(submissions.map((x) => [x.id, x.title]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const groupSize = new Map(groupSizes.map((g) => [g.group as string, Number(g.n)]));
  const dupOfThis = new Map(dupCounts.map((d) => [d.of as string, Number(d.n)]));

  return assets.map((a) => ({
    id: a.id,
    editionId: a.editionId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    format: a.format,
    aspectRatio: a.aspectRatio,
    orientation: a.orientation,
    dominantColour: a.dominantColour,
    qualityScore: a.qualityScore,
    qualityFlags: a.qualityFlags,
    caption: a.caption,
    altText: a.altText,
    photographer: a.photographer,
    credit: a.credit,
    rightsStatus: a.rightsStatus,
    rightsNote: a.rightsNote,
    aiDescription: a.aiDescription,
    aiTags: a.aiTags,
    kind: a.kind,
    duplicateOfId: a.duplicateOfId,
    similarityGroup: a.similarityGroup,
    isArchived: a.isArchived,
    createdAt: a.createdAt,
    submissionId: a.submissionId,
    submissionTitle: a.submissionId ? (submissionTitle.get(a.submissionId) ?? null) : null,
    contributorId: a.uploadedByContributorId,
    contributorName: a.uploadedByContributorId
      ? (contributorName.get(a.uploadedByContributorId) ?? null)
      : null,
    uploadedByName: a.uploadedByUserId ? (userName.get(a.uploadedByUserId) ?? null) : null,
    thumbUrl: thumbs[a.id] ?? null,
    webUrl: webs[a.id] ?? null,
    stories: (linksByAsset.get(a.id) ?? []).sort((x, y) => x.sortOrder - y.sortOrder),
    duplicateGroupSize: a.similarityGroup ? (groupSize.get(a.similarityGroup) ?? 0) : 0,
    duplicatesOfThis: dupOfThis.get(a.id) ?? 0,
  }));
}

async function facetsFor(scope: SQL | undefined): Promise<MediaFacets> {
  const [byRights, byKind, byFlag] = await Promise.all([
    db
      .select({ key: s.mediaAssets.rightsStatus, n: sql<number>`count(*)` })
      .from(s.mediaAssets)
      .where(scope)
      .groupBy(s.mediaAssets.rightsStatus),
    db
      .select({ key: s.mediaAssets.kind, n: sql<number>`count(*)` })
      .from(s.mediaAssets)
      .where(scope)
      .groupBy(s.mediaAssets.kind),
    db.execute<{ key: string; n: string }>(
      sql`select f as key, count(*) as n from ${s.mediaAssets}, unnest(${s.mediaAssets.qualityFlags}) as f where ${scope ?? sql`true`} group by f`,
    ),
  ]);
  const rights: Record<RightsStatus, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const r of byRights) rights[r.key] = Number(r.n);
  const kind: Record<string, number> = {};
  for (const k of byKind) kind[k.key] = Number(k.n);
  const flags: Record<string, number> = {};
  const flagRows =
    (byFlag as unknown as { rows?: { key: string; n: string }[] }).rows ??
    (byFlag as unknown as { key: string; n: string }[]);
  for (const f of Array.isArray(flagRows) ? flagRows : []) flags[f.key] = Number(f.n);
  return { rights, kind, flags };
}

/**
 * Paginated, filterable listing of an edition's media (or of every edition when `editionId` is null).
 * Rows come hydrated with signed thumbnail / web URLs, story links and provenance names.
 */
export async function listMedia(
  editionId: string | null,
  filters: MediaListFilters = {},
): Promise<MediaListResult> {
  const page = toInt(filters.page, 1, 1, 100_000);
  const pageSize = toInt(filters.pageSize, 48, 1, 200);
  const scope = scopeCondition(editionId, filters.archived === "true");
  const where = and(scope, ...filterConditions(filters));

  const [assets, [{ n: total }], facets] = await Promise.all([
    db
      .select()
      .from(s.mediaAssets)
      .where(where)
      .orderBy(...orderFor(filters.sort))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)` })
      .from(s.mediaAssets)
      .where(where),
    facetsFor(scope),
  ]);
  const rows = await hydrateRows(assets);
  const totalCount = Number(total);
  return {
    rows,
    total: totalCount,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    facets,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   getMediaDetail
   ────────────────────────────────────────────────────────────────────────── */

export type MediaVariantView = {
  id: string;
  kind: "THUMBNAIL" | "WEB" | "PRINT" | "CROP";
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
  cropSpec: s.CropSuggestion | null;
  url: string;
  downloadUrl: string;
  createdAt: Date;
};

export type SimilarAsset = {
  id: string;
  fileName: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  rightsStatus: RightsStatus;
  qualityScore: number | null;
  distance: number;
  relation: "exact" | "near" | "similar" | "group";
  duplicateOfId: string | null;
  isArchived: boolean;
  thumbUrl: string | null;
};

export type MediaAuditEntry = {
  id: string;
  action: string;
  actorType: string;
  userName: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type MediaConsentView = {
  id: string;
  type: "PUBLICATION" | "IMAGE_RIGHTS" | "DATA_PROCESSING";
  textVersion: string;
  text: string | null;
  accepted: boolean;
  acceptedAt: Date;
  revokedAt: Date | null;
  contributorName: string | null;
  scope: "asset" | "submission";
};

/** The asset row without its storage key (never sent to the client; URLs are signed instead). */
export type MediaAssetView = Omit<typeof s.mediaAssets.$inferSelect, "storageKey">;

export type MediaDetail = {
  asset: MediaAssetView;
  edition: { id: string; label: string; issueNumber: number; isSpecialIssue: boolean } | null;
  originalUrl: string;
  originalDownloadUrl: string;
  previewUrl: string;
  thumbUrl: string;
  variants: MediaVariantView[];
  submission: {
    id: string;
    title: string;
    storyType: string;
    status: string;
    editionId: string;
  } | null;
  contributor: { id: string; name: string; email: string; campusName: string | null } | null;
  uploadedBy: { id: string; name: string } | null;
  stories: MediaStoryLink[];
  bddReferences: {
    id: string;
    storyId: string;
    companyName: string;
    cohortLabel: string | null;
    field: "logo" | "teamPhoto" | "dashboard" | "diagram";
  }[];
  consents: MediaConsentView[];
  similar: SimilarAsset[];
  duplicateOf: {
    id: string;
    fileName: string;
    caption: string | null;
    thumbUrl: string | null;
  } | null;
  audit: MediaAuditEntry[];
  lastDescribeJob: {
    id: string;
    model: string;
    provider: string;
    status: string;
    cached: boolean;
    createdAt: Date;
  } | null;
};

export async function getMediaDetail(assetId: string): Promise<MediaDetail> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId) });
  if (!asset) throw new NotFoundError("Media asset");
  const storage = getStorage();
  const ttl = 3600;

  const [
    variantRows,
    edition,
    submission,
    contributor,
    uploadedBy,
    storyRows,
    bddRows,
    consentRows,
    auditRows,
    describeJob,
    candidates,
  ] = await Promise.all([
    db.query.mediaVariants.findMany({ where: eq(s.mediaVariants.assetId, assetId) }),
    asset.editionId
      ? db.query.editions.findFirst({
          where: eq(s.editions.id, asset.editionId),
          columns: { id: true, label: true, issueNumber: true, isSpecialIssue: true },
        })
      : null,
    asset.submissionId
      ? db.query.submissions.findFirst({
          where: eq(s.submissions.id, asset.submissionId),
          columns: { id: true, title: true, storyType: true, status: true, editionId: true },
        })
      : null,
    asset.uploadedByContributorId
      ? db.query.contributors.findFirst({
          where: eq(s.contributors.id, asset.uploadedByContributorId),
          with: { campus: { columns: { name: true } } },
        })
      : null,
    asset.uploadedByUserId
      ? db.query.users.findFirst({
          where: eq(s.users.id, asset.uploadedByUserId),
          columns: { id: true, name: true },
        })
      : null,
    db
      .select({
        id: s.stories.id,
        title: s.stories.title,
        status: s.stories.status,
        role: s.storyMedia.role,
        sortOrder: s.storyMedia.sortOrder,
      })
      .from(s.storyMedia)
      .innerJoin(s.stories, eq(s.stories.id, s.storyMedia.storyId))
      .where(eq(s.storyMedia.mediaAssetId, assetId))
      .orderBy(asc(s.storyMedia.sortOrder)),
    db
      .select({
        id: s.businessDeepDives.id,
        storyId: s.businessDeepDives.storyId,
        companyName: s.businessDeepDives.companyName,
        cohortLabel: s.businessDeepDives.cohortLabel,
        logoAssetId: s.businessDeepDives.logoAssetId,
        teamPhotoAssetId: s.businessDeepDives.teamPhotoAssetId,
        dashboardAssetId: s.businessDeepDives.dashboardAssetId,
        diagramAssetId: s.businessDeepDives.diagramAssetId,
      })
      .from(s.businessDeepDives)
      .where(
        or(
          eq(s.businessDeepDives.logoAssetId, assetId),
          eq(s.businessDeepDives.teamPhotoAssetId, assetId),
          eq(s.businessDeepDives.dashboardAssetId, assetId),
          eq(s.businessDeepDives.diagramAssetId, assetId),
        ),
      ),
    db
      .select({
        consent: s.consentRecords,
        firstName: s.contributors.firstName,
        lastName: s.contributors.lastName,
      })
      .from(s.consentRecords)
      .leftJoin(s.contributors, eq(s.contributors.id, s.consentRecords.contributorId))
      .where(
        or(
          eq(s.consentRecords.mediaAssetId, assetId),
          asset.submissionId
            ? and(
                eq(s.consentRecords.submissionId, asset.submissionId),
                eq(s.consentRecords.type, "IMAGE_RIGHTS"),
              )
            : undefined,
        ),
      )
      .orderBy(desc(s.consentRecords.acceptedAt)),
    db
      .select({
        id: s.auditLog.id,
        action: s.auditLog.action,
        actorType: s.auditLog.actorType,
        metadata: s.auditLog.metadata,
        createdAt: s.auditLog.createdAt,
        userName: s.users.name,
      })
      .from(s.auditLog)
      .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
      .where(and(eq(s.auditLog.entityType, "MEDIA"), eq(s.auditLog.entityId, assetId)))
      .orderBy(desc(s.auditLog.createdAt))
      .limit(60),
    db.query.aiJobs.findFirst({
      where: and(eq(s.aiJobs.service, "image_describer"), eq(s.aiJobs.entityId, assetId)),
      orderBy: [desc(s.aiJobs.createdAt)],
      columns: {
        id: true,
        model: true,
        provider: true,
        status: true,
        cached: true,
        createdAt: true,
      },
    }),
    db
      .select({
        id: s.mediaAssets.id,
        fileName: s.mediaAssets.fileName,
        caption: s.mediaAssets.caption,
        width: s.mediaAssets.width,
        height: s.mediaAssets.height,
        rightsStatus: s.mediaAssets.rightsStatus,
        qualityScore: s.mediaAssets.qualityScore,
        phash: s.mediaAssets.phash,
        sha256: s.mediaAssets.sha256,
        similarityGroup: s.mediaAssets.similarityGroup,
        duplicateOfId: s.mediaAssets.duplicateOfId,
        isArchived: s.mediaAssets.isArchived,
      })
      .from(s.mediaAssets)
      .where(
        and(
          ne(s.mediaAssets.id, assetId),
          asset.editionId ? eq(s.mediaAssets.editionId, asset.editionId) : undefined,
          isNotNull(s.mediaAssets.phash),
        ),
      ),
  ]);

  const kindOrder = { THUMBNAIL: 0, WEB: 1, PRINT: 2, CROP: 3 } as const;
  const variants: MediaVariantView[] = [];
  for (const v of [...variantRows].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])) {
    const base = asset.fileName.replace(/\.[^.]+$/, "");
    variants.push({
      id: v.id,
      kind: v.kind,
      width: v.width,
      height: v.height,
      sizeBytes: v.sizeBytes,
      format: v.format,
      cropSpec: v.cropSpec ?? null,
      createdAt: v.createdAt,
      url: await storage.getSignedUrl(v.storageKey, { expiresInSeconds: ttl }),
      downloadUrl: await storage.getSignedUrl(v.storageKey, {
        expiresInSeconds: ttl,
        download: {
          fileName: `${base}-${v.kind.toLowerCase()}.${v.format === "jpeg" ? "jpg" : v.format}`,
        },
      }),
    });
  }
  const originalUrl = await storage.getSignedUrl(asset.storageKey, { expiresInSeconds: ttl });
  const originalDownloadUrl = await storage.getSignedUrl(asset.storageKey, {
    expiresInSeconds: ttl,
    download: { fileName: asset.fileName },
  });
  const previewUrl = variants.find((v) => v.kind === "WEB")?.url ?? originalUrl;
  const thumbUrl = variants.find((v) => v.kind === "THUMBNAIL")?.url ?? previewUrl;

  // Similar assets: same similarity group, duplicate relations either way, or a close perceptual hash.
  const similar: SimilarAsset[] = [];
  for (const c of candidates) {
    const distance =
      asset.phash && c.phash ? hammingDistance(asset.phash, c.phash) : Number.POSITIVE_INFINITY;
    const exact = !!asset.sha256 && c.sha256 === asset.sha256;
    const grouped = !!asset.similarityGroup && c.similarityGroup === asset.similarityGroup;
    const related = c.duplicateOfId === assetId || asset.duplicateOfId === c.id;
    if (!exact && !grouped && !related && distance > SIMILAR_THRESHOLD) continue;
    const relation: SimilarAsset["relation"] = exact
      ? "exact"
      : distance <= DUPLICATE_THRESHOLD
        ? "near"
        : distance <= SIMILAR_THRESHOLD
          ? "similar"
          : "group";
    similar.push({
      id: c.id,
      fileName: c.fileName,
      caption: c.caption,
      width: c.width,
      height: c.height,
      rightsStatus: c.rightsStatus,
      qualityScore: c.qualityScore,
      distance: Number.isFinite(distance) ? distance : 64,
      relation,
      duplicateOfId: c.duplicateOfId,
      isArchived: c.isArchived,
      thumbUrl: null,
    });
  }
  similar.sort((a, b) => a.distance - b.distance);
  const similarTop = similar.slice(0, 12);
  const similarIds = similarTop.map((x) => x.id);
  const extraIds =
    asset.duplicateOfId && !similarIds.includes(asset.duplicateOfId) ? [asset.duplicateOfId] : [];
  const thumbs = await mediaUrls([...similarIds, ...extraIds], "THUMBNAIL");
  for (const x of similarTop) x.thumbUrl = thumbs[x.id] ?? null;

  let duplicateOf: MediaDetail["duplicateOf"] = null;
  if (asset.duplicateOfId) {
    const original = await db.query.mediaAssets.findFirst({
      where: eq(s.mediaAssets.id, asset.duplicateOfId),
      columns: { id: true, fileName: true, caption: true },
    });
    if (original) duplicateOf = { ...original, thumbUrl: thumbs[original.id] ?? null };
  }

  const bddReferences: MediaDetail["bddReferences"] = [];
  for (const b of bddRows) {
    const fields: MediaDetail["bddReferences"][number]["field"][] = [];
    if (b.logoAssetId === assetId) fields.push("logo");
    if (b.teamPhotoAssetId === assetId) fields.push("teamPhoto");
    if (b.dashboardAssetId === assetId) fields.push("dashboard");
    if (b.diagramAssetId === assetId) fields.push("diagram");
    for (const field of fields)
      bddReferences.push({
        id: b.id,
        storyId: b.storyId,
        companyName: b.companyName,
        cohortLabel: b.cohortLabel,
        field,
      });
  }

  const consents: MediaConsentView[] = consentRows.map((r) => ({
    id: r.consent.id,
    type: r.consent.type,
    textVersion: r.consent.textVersion,
    text:
      r.consent.type in CONSENT_TEXTS
        ? CONSENT_TEXTS[r.consent.type as keyof typeof CONSENT_TEXTS]
        : null,
    accepted: r.consent.accepted,
    acceptedAt: r.consent.acceptedAt,
    revokedAt: r.consent.revokedAt,
    contributorName: r.firstName ? `${r.firstName} ${r.lastName}` : null,
    scope: r.consent.mediaAssetId === assetId ? "asset" : "submission",
  }));

  const { storageKey: _storageKey, ...assetView } = asset;
  void _storageKey;
  return {
    asset: assetView,
    edition: edition ?? null,
    originalUrl,
    originalDownloadUrl,
    previewUrl,
    thumbUrl,
    variants,
    submission: submission ?? null,
    contributor: contributor
      ? {
          id: contributor.id,
          name: `${contributor.firstName} ${contributor.lastName}`,
          email: contributor.email,
          campusName: contributor.campus?.name ?? null,
        }
      : null,
    uploadedBy: uploadedBy ?? null,
    stories: storyRows,
    bddReferences,
    consents,
    similar: similarTop,
    duplicateOf,
    audit: auditRows.map((a) => ({
      id: a.id,
      action: a.action,
      actorType: a.actorType,
      userName: a.userName ?? null,
      metadata: a.metadata ?? {},
      createdAt: a.createdAt,
    })),
    lastDescribeJob: describeJob ?? null,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   mediaStats
   ────────────────────────────────────────────────────────────────────────── */

export type MediaStats = {
  total: number;
  byRights: Record<RightsStatus, number>;
  lowQuality: number;
  duplicates: number;
  /** Assets that belong to a similarity group (duplicates and their originals). */
  inGroups: number;
  printReady: number;
  described: number;
  unused: number;
  archived: number;
};

export async function mediaStats(editionId: string): Promise<MediaStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived})`,
      green: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.rightsStatus} = 'GREEN')`,
      yellow: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.rightsStatus} = 'YELLOW')`,
      red: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.rightsStatus} = 'RED')`,
      lowQuality: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and coalesce(${s.mediaAssets.qualityScore}, 0) < ${LOW_QUALITY_THRESHOLD})`,
      duplicates: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.duplicateOfId} is not null)`,
      inGroups: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.similarityGroup} is not null)`,
      printReady: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.width} >= ${PRINT_READY_MIN_WIDTH} and ${s.mediaAssets.rightsStatus} = 'GREEN')`,
      described: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${s.mediaAssets.aiDescription} is not null)`,
      unused: sql<number>`count(*) filter (where not ${s.mediaAssets.isArchived} and ${unusedCondition()})`,
      archived: sql<number>`count(*) filter (where ${s.mediaAssets.isArchived})`,
    })
    .from(s.mediaAssets)
    .where(eq(s.mediaAssets.editionId, editionId));
  return {
    total: Number(row?.total ?? 0),
    byRights: {
      GREEN: Number(row?.green ?? 0),
      YELLOW: Number(row?.yellow ?? 0),
      RED: Number(row?.red ?? 0),
    },
    lowQuality: Number(row?.lowQuality ?? 0),
    duplicates: Number(row?.duplicates ?? 0),
    inGroups: Number(row?.inGroups ?? 0),
    printReady: Number(row?.printReady ?? 0),
    described: Number(row?.described ?? 0),
    unused: Number(row?.unused ?? 0),
    archived: Number(row?.archived ?? 0),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   Stories (for pickers and filters)
   ────────────────────────────────────────────────────────────────────────── */

export type StoryPickerItem = {
  id: string;
  title: string;
  status: string;
  storyType: string;
  sectionName: string | null;
  mediaCount: number;
};

export async function listStoriesForPicker(editionId: string): Promise<StoryPickerItem[]> {
  const rows = await db
    .select({
      id: s.stories.id,
      title: s.stories.title,
      status: s.stories.status,
      storyType: s.stories.storyType,
      sectionName: s.editionSections.name,
      sectionOrder: s.editionSections.sortOrder,
      mediaCount: sql<number>`(select count(*) from ${s.storyMedia} sm where sm.story_id = ${s.stories.id})`,
    })
    .from(s.stories)
    .leftJoin(s.editionSections, eq(s.editionSections.id, s.stories.sectionId))
    .where(
      and(
        eq(s.stories.editionId, editionId),
        sql`${s.stories.status} not in ('REJECTED', 'DROPPED')`,
      ),
    )
    .orderBy(
      sql`${s.editionSections.sortOrder} nulls last`,
      desc(s.stories.priority),
      asc(s.stories.title),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    storyType: r.storyType,
    sectionName: r.sectionName ?? null,
    mediaCount: Number(r.mediaCount),
  }));
}

/* ──────────────────────────────────────────────────────────────────────────
   recommendMediaForStory
   ────────────────────────────────────────────────────────────────────────── */

export type MediaRecommendation = {
  id: string;
  fileName: string;
  caption: string | null;
  altText: string | null;
  kind: string;
  width: number | null;
  height: number | null;
  qualityScore: number | null;
  qualityFlags: string[];
  rightsStatus: RightsStatus;
  submissionId: string | null;
  contributorName: string | null;
  thumbUrl: string | null;
  webUrl: string | null;
  score: number;
  reasons: string[];
  alreadyAttached: boolean;
};

const BDD_VISUAL_KINDS = new Set(["logo", "screenshot", "diagram", "chart"]);

/**
 * Ranks the edition's usable media for a story: the story's own submission photos first, then
 * photos from the same contributors, then caption / tag overlap with the story, quality and rights.
 * RED-rights and archived assets are never recommended. Returns the top `limit` (default 12) with
 * human-readable reasons — used by the story and article screens' media pickers.
 */
export async function recommendMediaForStory(
  storyId: string,
  options: { limit?: number; includeAttached?: boolean } = {},
): Promise<MediaRecommendation[]> {
  const limit = options.limit ?? 12;
  const story = await db.query.stories.findFirst({
    where: eq(s.stories.id, storyId),
    columns: {
      id: true,
      editionId: true,
      clusterId: true,
      title: true,
      summary: true,
      storyType: true,
    },
  });
  if (!story) throw new NotFoundError("Story");

  const [clusterSubs, articleSubs, attachedRows, bdd] = await Promise.all([
    story.clusterId
      ? db
          .select({ id: s.storyClusterMembers.submissionId })
          .from(s.storyClusterMembers)
          .where(eq(s.storyClusterMembers.clusterId, story.clusterId))
      : [],
    db
      .select({ id: s.articleSources.submissionId })
      .from(s.articleSources)
      .innerJoin(s.articles, eq(s.articles.id, s.articleSources.articleId))
      .where(eq(s.articles.storyId, storyId)),
    db
      .select({ id: s.storyMedia.mediaAssetId })
      .from(s.storyMedia)
      .where(eq(s.storyMedia.storyId, storyId)),
    story.storyType === "BUSINESS_DEEP_DIVE"
      ? db.query.businessDeepDives.findFirst({
          where: eq(s.businessDeepDives.storyId, storyId),
          columns: { companyName: true, cohortLabel: true },
        })
      : null,
  ]);
  const submissionIds = [...new Set([...clusterSubs, ...articleSubs].map((x) => x.id))];
  const attached = new Set(attachedRows.map((x) => x.id));
  const submissions = submissionIds.length
    ? await db
        .select({
          id: s.submissions.id,
          title: s.submissions.title,
          contributorId: s.submissions.contributorId,
        })
        .from(s.submissions)
        .where(inArray(s.submissions.id, submissionIds))
    : [];
  const submissionTitle = new Map(submissions.map((x) => [x.id, x.title]));
  const contributorIds = new Set(
    submissions.map((x) => x.contributorId).filter((x): x is string => !!x),
  );

  const candidates = await db
    .select()
    .from(s.mediaAssets)
    .where(
      and(
        eq(s.mediaAssets.editionId, story.editionId),
        eq(s.mediaAssets.isArchived, false),
        ne(s.mediaAssets.rightsStatus, "RED"),
      ),
    );
  if (!candidates.length) return [];

  const contributorNames = new Map<string, string>();
  const candidateContributorIds = [
    ...new Set(candidates.map((c) => c.uploadedByContributorId).filter((x): x is string => !!x)),
  ];
  if (candidateContributorIds.length) {
    const rows = await db
      .select({
        id: s.contributors.id,
        firstName: s.contributors.firstName,
        lastName: s.contributors.lastName,
      })
      .from(s.contributors)
      .where(inArray(s.contributors.id, candidateContributorIds));
    for (const r of rows) contributorNames.set(r.id, `${r.firstName} ${r.lastName}`);
  }

  const storyText = [
    story.title,
    story.summary ?? "",
    bdd?.companyName ?? "",
    bdd?.cohortLabel ?? "",
  ].join(" ");
  const storyTokens = new Set(contentTokens(storyText));

  const scored = candidates
    .filter((c) => options.includeAttached || !attached.has(c.id))
    .map((c) => {
      let score = 0;
      const reasons: string[] = [];
      if (c.submissionId && submissionIds.includes(c.submissionId)) {
        score += 100;
        reasons.push(
          `Sent with “${submissionTitle.get(c.submissionId) ?? "this story's submission"}”`,
        );
      } else if (c.uploadedByContributorId && contributorIds.has(c.uploadedByContributorId)) {
        score += 40;
        reasons.push(
          `Uploaded by ${contributorNames.get(c.uploadedByContributorId) ?? "a contributor to this story"}`,
        );
      }
      const assetText = [
        c.caption ?? "",
        c.altText ?? "",
        c.aiDescription ?? "",
        c.fileName.replace(/[-_.]+/g, " "),
        c.aiTags.join(" "),
      ].join(" ");
      const overlap = [...new Set(contentTokens(assetText))].filter((t) => storyTokens.has(t));
      if (overlap.length) {
        score += Math.min(40, overlap.length * 10);
        reasons.push(
          `Matches ${overlap
            .slice(0, 3)
            .map((t) => `“${t}”`)
            .join(", ")}`,
        );
      }
      if (story.storyType === "BUSINESS_DEEP_DIVE" && BDD_VISUAL_KINDS.has(c.kind)) {
        score += 5;
        reasons.push(
          `${c.kind[0].toUpperCase()}${c.kind.slice(1)} — useful for a Business Deep Dive`,
        );
      }
      const quality = c.qualityScore ?? 0;
      score += Math.round(quality * 0.2);
      if (quality >= 80) reasons.push(`Quality ${quality}`);
      else if (quality < LOW_QUALITY_THRESHOLD) reasons.push(`Low quality (${quality})`);
      if (c.rightsStatus === "GREEN") {
        score += 15;
        reasons.push("Rights approved");
      } else {
        reasons.push("Rights still unclear");
      }
      if (c.duplicateOfId) {
        score -= 30;
        reasons.push("Marked as a duplicate");
      }
      return { asset: c, score, reasons };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.asset.qualityScore ?? 0) - (a.asset.qualityScore ?? 0) ||
        b.asset.createdAt.getTime() - a.asset.createdAt.getTime(),
    )
    .slice(0, limit);

  const ids = scored.map((x) => x.asset.id);
  const [thumbs, webs] = await Promise.all([mediaUrls(ids, "THUMBNAIL"), mediaUrls(ids, "WEB")]);
  return scored.map(({ asset: c, score, reasons }) => ({
    id: c.id,
    fileName: c.fileName,
    caption: c.caption,
    altText: c.altText,
    kind: c.kind,
    width: c.width,
    height: c.height,
    qualityScore: c.qualityScore,
    qualityFlags: c.qualityFlags,
    rightsStatus: c.rightsStatus,
    submissionId: c.submissionId,
    contributorName: c.uploadedByContributorId
      ? (contributorNames.get(c.uploadedByContributorId) ?? null)
      : null,
    thumbUrl: thumbs[c.id] ?? null,
    webUrl: webs[c.id] ?? null,
    score,
    reasons,
    alreadyAttached: attached.has(c.id),
  }));
}
