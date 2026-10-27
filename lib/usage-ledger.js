/**
 * Host-side usage ledger: subscribes the global `session/event` feed, folds
 * every assistant-message's provider-reported token usage into hourly
 * buckets retaining both model identities, and persists the stream to a JSONL file inside
 * the plugin's local data directory so the chart survives restarts.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { modelIdentityFromSource } from "./model-identity.js";
/** How long the in-memory ledger keeps history (rolling window). */
const RETENTION_MS = 120 * 24 * 60 * 60 * 1_000;
/** Hour bucket key: local 'YYYY-MM-DDTHH'. */
function hourKey(time) {
    const d = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
}
function emptyUsage() {
    return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}
function addUsage(target, u) {
    target.input += u.input;
    target.cacheRead += u.cacheRead;
    target.cacheWrite += u.cacheWrite;
    target.output += u.output;
}
/** Legacy `model` was the request identity; it cannot recover a response. */
function readRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    const raw = value;
    if (raw.version !== undefined && raw.version !== 2)
        return null;
    const legacy = raw.version === undefined;
    const requestedModel = legacy ? raw.model : raw.requestedModel;
    if (typeof requestedModel !== 'string' || requestedModel.trim().length === 0)
        return null;
    for (const field of ['t', 'input', 'cacheRead', 'cacheWrite', 'output']) {
        if (typeof raw[field] !== 'number' || !Number.isFinite(raw[field]) || raw[field] < 0)
            return null;
    }
    if (!Number.isFinite(new Date(raw.t).getTime()))
        return null;
    return {
        version: 2,
        t: raw.t,
        provider: !legacy && typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider : null,
        requestedModel,
        responseModel: !legacy && typeof raw.responseModel === 'string' && raw.responseModel.trim()
            ? raw.responseModel : null,
        input: raw.input,
        cacheRead: raw.cacheRead,
        cacheWrite: raw.cacheWrite,
        output: raw.output,
    };
}
export class UsageLedger {
    /** hourKey → [provider, requestedModel, responseModel] → aggregate record. */
    hourly = new Map();
    file;
    constructor(dataDir) {
        this.file = join(dataDir, 'usage.jsonl');
        mkdirSync(dataDir, { recursive: true });
        this.load();
    }
    load() {
        if (!existsSync(this.file))
            return;
        try {
            const cutoff = Date.now() - RETENTION_MS;
            let lineCount = 0;
            let stale = 0;
            let unreadable = false;
            for (const line of readFileSync(this.file, 'utf8').split('\n')) {
                if (line.trim().length === 0)
                    continue;
                lineCount += 1;
                let record;
                try {
                    record = readRecord(JSON.parse(line));
                }
                catch {
                    unreadable = true;
                    continue;
                }
                if (record === null) {
                    unreadable = true;
                    continue;
                }
                if (record.t < cutoff) {
                    stale += 1;
                    continue;
                }
                this.ingest(record);
            }
            // Rewrite the file when the stale tail is significant (keeps the
            // durable file bounded without per-event rewriting).
            // Do not destroy an unreadable or future-version row during migration.
            if (!unreadable && stale > 0 && stale > lineCount / 4)
                this.rewriteFile();
        }
        catch {
            // A corrupt/unreadable ledger must never block plugin startup.
        }
    }
    rewriteFile() {
        const lines = [];
        const cutoff = Date.now() - RETENTION_MS;
        for (const models of this.hourly.values()) {
            for (const record of models.values()) {
                if (record.t >= cutoff)
                    lines.push(JSON.stringify(record));
            }
        }
        try {
            writeFileSync(this.file, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');
        }
        catch {
            // best-effort compaction
        }
    }
    /** One assistant message's usage into the ledger (in-memory + append). */
    record(event) {
        if (event.type !== 'assistant/message')
            return;
        const usage = event.data.usage;
        if (usage === undefined)
            return;
        const identity = modelIdentityFromSource(event.data.message.source);
        if (identity === null)
            return;
        const record = {
            version: 2,
            t: event.time,
            ...identity,
            input: usage.inputTokens,
            cacheRead: usage.cacheReadTokens ?? 0,
            cacheWrite: usage.cacheWriteTokens ?? 0,
            output: usage.outputTokens,
        };
        this.ingest(record);
        try {
            appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
        }
        catch {
            // persistence failure must not break the session feed
        }
    }
    ingest(record) {
        const key = hourKey(record.t);
        let models = this.hourly.get(key);
        if (models === undefined) {
            models = new Map();
            this.hourly.set(key, models);
        }
        const identityKey = JSON.stringify([record.provider, record.requestedModel, record.responseModel]);
        const aggregate = models.get(identityKey);
        if (aggregate === undefined)
            models.set(identityKey, { ...record });
        else
            addUsage(aggregate, record);
        // Rolling cleanup (amortized: a few maps per new hour).
        if (this.hourly.size > 24 * 130) {
            const cutoff = Date.now() - RETENTION_MS;
            for (const key2 of this.hourly.keys()) {
                if (new Date(`${key2}:00`).getTime() + 3_600_000 <= cutoff)
                    this.hourly.delete(key2);
            }
        }
    }
    /**
     * Query totals by REQUESTED model for the existing price book/chart API.
     * The durable aggregates still retain response identities independently.
     * `offset` 0 = current period, 1 = previous,
     * etc. Buckets are produced in chronological order with a stable key
     * (day: 'HH:00'; week/month: 'MM-DD').
     */
    query(period, offset, now = Date.now()) {
        const start = periodStartWithOffset(period, offset, now);
        const count = period === 'day' ? 24 : period === 'week' ? 7 : daysInMonth(new Date(start));
        const bucketMs = period === 'day' ? 3_600_000 : 24 * 3_600_000;
        const buckets = [];
        for (let i = 0; i < count; i += 1) {
            const bucketTime = start + i * bucketMs;
            const key = period === 'day'
                ? `${String(new Date(bucketTime).getHours()).padStart(2, '0')}:00`
                : `${String(new Date(bucketTime).getMonth() + 1).padStart(2, '0')}-${String(new Date(bucketTime).getDate()).padStart(2, '0')}`;
            const models = new Map();
            const mergeHour = (hourMap) => {
                if (hourMap === undefined)
                    return;
                for (const record of hourMap.values()) {
                    const target = models.get(record.requestedModel) ?? emptyUsage();
                    addUsage(target, record);
                    models.set(record.requestedModel, target);
                }
            };
            if (period === 'day') {
                mergeHour(this.hourly.get(hourKey(bucketTime)));
            }
            else {
                // Fold the 24 hourly buckets of each day.
                for (let h = 0; h < 24; h += 1) {
                    mergeHour(this.hourly.get(hourKey(bucketTime + h * 3_600_000)));
                }
            }
            buckets.push({ key, usage: Object.fromEntries(models) });
        }
        return { start, end: start + count * bucketMs, buckets };
    }
}
/** Start of the current period in local time. */
export function periodStart(period, now = Date.now()) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    if (period === 'day') {
        // Day buckets run from 00:00 — clearing only minutes would keep the
        // current hour, shifting the first column away from 00:00.
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    if (period === 'week') {
        // Monday 00:00 of the current week.
        const mondayOffset = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - mondayOffset);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    // Month: the 1st, 00:00.
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
/**
 * Start of the period `offset` periods before the current one. Day/week
 * step by fixed milliseconds; month steps calendar months (a month is not a
 * fixed duration, so plain arithmetic would be wrong).
 */
export function periodStartWithOffset(period, offset, now = Date.now()) {
    const start = periodStart(period, now);
    if (offset <= 0)
        return start;
    if (period === 'month') {
        const d = new Date(start);
        d.setMonth(d.getMonth() - offset);
        return d.getTime();
    }
    return start - offset * (period === 'day' ? 24 * 3_600_000 : 7 * 24 * 3_600_000);
}
function daysInMonth(monthStart) {
    return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
}
/** Plugin data directory: <dsh home>/dsh-status-bar. */
export function ledgerDataDir(envHome) {
    const home = envHome && envHome.trim().length > 0 ? envHome : join(homedir(), '.dsh');
    return join(home, 'dsh-status-bar');
}
//# sourceMappingURL=usage-ledger.js.map