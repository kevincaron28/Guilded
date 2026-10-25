import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { discordJob: mocks } }));
vi.mock("../src/hosted-pilot.js", () => ({ pilotGuildScope: {} }));
import { runDiscordJobs } from "../src/services/discord-jobs.js";

beforeEach(() => { vi.resetAllMocks(); mocks.updateMany.mockResolvedValue({ count: 0 }); });
afterEach(() => vi.useRealTimers());

function backlog(ordinary: number, countdowns: number) {
  mocks.findMany.mockImplementation(async ({ where, take }) => Array.from({ length: Math.min(take, typeof where.kind === "string" ? countdowns : ordinary) }, (_, i) => ({ id: `${typeof where.kind === "string" ? "board" : "reminder"}-${i}`, guild: { discordId: "server" } })));
}
const claims = () => mocks.updateMany.mock.calls.map(([query]) => query.where.id);

describe("countdown backpressure in the shared Discord worker", () => {
  it("serves reminders first and limits a 200-board backlog to five refreshes", async () => {
    backlog(2, 200);
    await runDiscordJobs({} as never);
    expect(claims()).toEqual(["reminder-0", "reminder-1", "board-0", "board-1", "board-2", "board-3", "board-4"]);
  });
  it("leaves countdowns pending when the ordinary delivery queue fills the batch", async () => {
    backlog(40, 200);
    await runDiscordJobs({} as never);
    expect(claims()).toHaveLength(25);
    expect(claims().every(id => id.startsWith("reminder-"))).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledOnce();
  });
  it("never exceeds the overall batch cap with spare countdown slots", async () => {
    backlog(23, 200);
    await runDiscordJobs({} as never);
    expect(claims()).toHaveLength(25);
    expect(claims().slice(-2)).toEqual(["board-0", "board-1"]);
  });
  it("stops starting jobs after the time budget rather than piling up slow work", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    backlog(25, 200);
    mocks.updateMany.mockImplementation(async () => { vi.setSystemTime(Date.now() + 6_000); return { count: 0 }; });
    await runDiscordJobs({} as never);
    expect(claims()).toHaveLength(4);
  });
  it("does not overlap workers while a previous tick is still waiting for the database", async () => {
    let release!: (value: []) => void;
    mocks.findMany.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue([]);
    const first = runDiscordJobs({} as never);
    await runDiscordJobs({} as never);
    expect(mocks.findMany).toHaveBeenCalledOnce();
    release([]); await first;
  });
});
