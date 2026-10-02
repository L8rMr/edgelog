import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { blankReview, summarizeReview } from "../../../lib/journal";
import type { Review } from "../../../lib/journal";

// Self-hosted reviews are independent of broker imports and analysis rewrites.
const directory = () => join(process.env.EDGELOG_DATA_DIR || ".edgelog-data", "reviews");
const fileFor = (id: string) => join(directory(), createHash("sha256").update(id).digest("hex") + ".json");
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;
async function readReview(id: string): Promise<Review> {
    try { return JSON.parse(await readFile(fileFor(id), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return blankReview(id); throw error; }
}
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

export async function GET(request: Request) {
    try {
        const id = new URL(request.url).searchParams.get("tradeId");
        if (id !== null) return validId(id) ? json({ review: await readReview(id) }) : json({ error: "Invalid trade ID." }, 400);
        let files: string[];
        try { files = await readdir(directory()); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return json({ reviews: [] }); throw error; }
        const reviews = await Promise.all(files.filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(async file => summarizeReview(JSON.parse(await readFile(join(directory(), file), "utf8")))));
        return json({ reviews });
    } catch { return json({ error: "Reviews could not be loaded. Try again." }, 500); }
}

// Serialize the revision check and atomic write so overlapping saves cannot lose a review.
let writes = Promise.resolve();
export async function PUT(request: Request) {
    try {
        if (Number(request.headers.get("content-length")) > 3_000_000) return json({ error: "Review is too large." }, 413);
        const text = await request.text();
        if (Buffer.byteLength(text) > 3_000_000) return json({ error: "Review is too large." }, 413);
        let input: Review;
        try { input = JSON.parse(text); } catch { return json({ error: "Invalid review JSON." }, 400); }
        if (!input || !validId(input.tradeId) || !["pending", "reviewed"].includes(input.status) || typeof input.flagged !== "boolean"
            || !["reconstructed", "entry-notes"].includes(input.thesisSource) || !["unrated", "followed", "broke"].includes(input.process)
            || !Number.isInteger(input.revision) || input.revision < 0
            || [input.thesis, input.reflection, input.repeat, input.avoid].some(t => typeof t !== "string" || t.length > 10000)
            || !Array.isArray(input.screenshots) || input.screenshots.length > 2) return json({ error: "Invalid review fields." }, 400);
        for (const image of input.screenshots) {
            if (!image || !validId(image.id) || typeof image.name !== "string" || image.name.length > 200
                || typeof image.dataUrl !== "string" || image.dataUrl.length > 1_400_000
                || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) return json({ error: "Use up to two PNG, JPEG or WebP images, each under 1 MB." }, 400);
        }
        const task = writes.then(async () => {
            const previous = await readReview(input.tradeId);
            if (previous.revision !== input.revision) return json({ error: "This review changed in another window. Reopen it to load the latest version before saving." }, 409);
            const next: Review = {
                ...blankReview(input.tradeId), status: input.status, flagged: input.flagged,
                thesis: input.thesis, thesisSource: input.thesisSource, reflection: input.reflection,
                repeat: input.repeat, avoid: input.avoid, process: input.process,
                screenshots: input.screenshots.map(({ id, name, dataUrl }) => ({ id, name, dataUrl })),
                revision: previous.revision + 1, updatedAt: new Date().toISOString(),
            };
            await mkdir(directory(), { recursive: true });
            const file = fileFor(input.tradeId), temp = file + "." + randomUUID() + ".tmp";
            await writeFile(temp, JSON.stringify(next), "utf8");
            await rename(temp, file);
            return json({ review: next });
        });
        writes = task.then(() => undefined, () => undefined);
        return await task;
    } catch { return json({ error: "Review was not saved. Your changes are still open; try again." }, 500); }
}
