import { test } from "node:test";
import assert from "node:assert/strict";
import type { Clip } from "../src/recorder";
import { FILM, Film, PhotoCam, chooseClips, dayText, emptyOverlay, filmFileName, filmNote, filmView, photoFileName, pickFilmType, planFilm, stepTick, titleCard, type FilmHost } from "../src/film";

const reel = (spec: Array<[number, number]>) => spec.map(([score, tick]) => ({ moment: { score, tick } }));

test("the film takes the five best clips, in the order they happened", () => {
  const r = reel([[10, 100], [50, 900], [30, 300], [70, 700], [20, 200], [60, 600], [40, 400], [5, 50]]);
  const c = chooseClips(r);
  assert.equal(c.length, 5);
  assert.deepEqual(c.map((x) => x.moment.tick), [300, 400, 600, 700, 900]);
});

test("a reel of fewer than five is played whole, in tick order; an empty reel gives nothing", () => {
  assert.deepEqual(chooseClips(reel([[9, 500], [8, 100], [7, 300]])).map((x) => x.moment.tick), [100, 300, 500]);
  assert.deepEqual(chooseClips(reel([])), []);
});

test("equal scores: the later moment wins the last place", () => {
  const c = chooseClips(reel([[5, 100], [5, 200], [5, 300], [5, 400], [5, 500], [5, 600]]));
  assert.deepEqual(c.map((x) => x.moment.tick), [200, 300, 400, 500, 600]);
});

test("five clips: the budgets and the title add up to between 30 and 45 s", () => {
  const p = planFilm(5);
  assert.equal(p.budgets.length, 5);
  assert.ok(p.total >= FILM.min && p.total <= FILM.max, `total ${p.total}`);
  assert.ok(Math.abs(p.title - 3) < 1e-9);
  assert.ok(p.budgets.every((b) => b > 5 && b < 9));
});

test("fewer clips: each gets at most its cap and the film is just shorter", () => {
  let last = Infinity;
  for (let n = 5; n >= 1; n--) {
    const p = planFilm(n);
    assert.equal(p.clips, n);
    assert.ok(p.total <= last + 1e-9);
    assert.ok(p.budgets.every((b) => b + FILM.lead <= FILM.perClipMax + 1e-9));
    assert.ok(p.total <= FILM.max);
    last = p.total;
  }
  assert.ok(planFilm(1).total < FILM.min);
  assert.equal(planFilm(0).clips, 0);
  assert.equal(planFilm(9).clips, 5);
});

test("a scale shrinks every time", () => {
  const a = planFilm(5), b = planFilm(5, 0.1);
  assert.ok(Math.abs(b.title - a.title * 0.1) < 1e-9);
  assert.ok(b.total < a.total * 0.2);
});

test("the Status says when the film is shorter", () => {
  assert.match(filmNote(5), /5 best clips/);
  assert.match(filmNote(2), /shorter this time/);
  assert.match(filmNote(2), /2 clips/);
  assert.match(filmNote(1), /1 clip,/);
  assert.match(filmNote(0), /empty/);
});

test("the title card: both castles, the result, the day", () => {
  const d = new Date(2026, 10, 10, 14, 32);
  assert.equal(dayText(d), "Tuesday 10 November 2026");
  const win = titleCard({ me: { name: "You", team: 1 }, foe: { name: "Enemy", team: 0 }, winner: 1, short: "The enemy keep has fallen", clock: "12:04", date: d });
  assert.equal(win.result, "Victory");
  assert.deepEqual(win.sides.map((s) => s.team), [1, 0]);
  assert.equal(win.day, "Tuesday 10 November 2026");
  assert.match(win.line, /12:04/);
  assert.equal(titleCard({ me: { name: "You", team: 1 }, foe: { name: "Enemy", team: 0 }, winner: 0, short: "x", clock: "1:00", date: d }).result, "Defeat");
  assert.equal(titleCard({ me: { name: "You", team: 1 }, foe: { name: "Enemy", team: 0 }, winner: -1, short: "x", clock: "1:00", date: d }).result, "A draw");
  assert.equal(titleCard({ me: { name: "You", team: 1 }, foe: { name: "Enemy", team: 0 }, winner: null, short: "x", clock: "1:00", date: d }).result, "So far");
});

test("file names follow the replay file's", () => {
  const d = new Date(2026, 10, 10, 14, 32);
  assert.equal(filmFileName("webm", d), "keepfall-film-2026-11-10-1432.webm");
  assert.equal(filmFileName("mp4", d), "keepfall-film-2026-11-10-1432.mp4");
  assert.equal(photoFileName(d), "keepfall-photo-2026-11-10-1432.png");
});

test("the recording type: webm first, mp4 where webm is not offered, none otherwise", () => {
  assert.equal(pickFilmType(() => true)?.ext, "webm");
  assert.equal(pickFilmType((t) => t.startsWith("video/mp4"))?.ext, "mp4");
  assert.equal(pickFilmType(() => false), null);
});

/** A host that plays each clip for a fixed number of updates. */
function host(framesPerClip: number) {
  const log: string[] = [];
  let left = 0;
  let onEnd: (() => void) | null = null;
  let current = "";
  const h: FilmHost = {
    playClip: (clip, budget, end) => {
      current = `${clip.moment.tick}`;
      log.push(`play ${current} budget ${budget.toFixed(2)}`);
      left = framesPerClip;
      onEnd = end;
    },
    cancelClip: () => {
      log.push(`cancel ${current}`);
      onEnd = null;
    },
    updateClip: () => {
      if (--left <= 0) {
        const e = onEnd;
        onEnd = null;
        log.push(`end ${current}`);
        e?.();
      }
    },
    show: (on) => log.push(`show ${on}`),
    paint: (_st, world) => log.push(world ? "paint world" : "paint title"),
    done: (c) => log.push(`done ${c}`),
  };
  return { h, log };
}
const clip = (tick: number, score: number) => ({ moment: { tick, score } }) as unknown as Clip;
const card = titleCard({ me: { name: "You", team: 1 }, foe: { name: "Enemy", team: 0 }, winner: 1, short: "x", clock: "1:00", date: new Date(2026, 0, 1) });

test("the film plays its title, then the clips in tick order, one straight after the other, then ends", () => {
  const { h, log } = host(2);
  const f = new Film(h);
  const plan = f.start([clip(900, 5), clip(100, 9), clip(500, 7)], card, { scale: 0.1 });
  assert.ok(plan);
  assert.equal(f.phase, "title");
  let n = 0;
  while (f.active && n++ < 1000) f.update(1 / 30);
  assert.equal(f.active, false);
  assert.deepEqual(f.played, [100, 500, 900]);
  const plays = log.filter((l) => l.startsWith("play"));
  assert.equal(plays.length, 3);
  assert.equal(log[log.length - 1], "done true");
  assert.equal(log[0], "show true");
  // No page frame between one clip's end and the next one's start: the next play follows the end in the same update.
  for (let i = 0; i < log.length; i++) if (log[i].startsWith("end ")) assert.ok(log[i + 1].startsWith("play ") || log[i + 1] === "show false" || log[i + 1] === "done true", log[i + 1]);
  // The title ran about its planned length.
  assert.ok(Math.abs(log.filter((l) => l === "paint title").length / 30 - plan!.title) < 0.1);
});

test("a skip mid-film ends the whole film: the clip is cancelled, nothing more plays", () => {
  const { h, log } = host(50);
  const f = new Film(h);
  f.start([clip(1, 1), clip(2, 2)], card, { scale: 0.05 });
  for (let i = 0; i < 200 && f.phase !== "clip"; i++) f.update(1 / 30);
  assert.equal(f.phase, "clip");
  f.update(1 / 30);
  f.cancel();
  assert.equal(f.active, false);
  assert.ok(log.includes("cancel 1"));
  assert.equal(log[log.length - 1], "done false");
  assert.equal(log.filter((l) => l.startsWith("play")).length, 1);
  f.update(1 / 30);
  assert.equal(log[log.length - 1], "done false");
  // A film can start again.
  assert.ok(f.start([clip(3, 1)], card, { scale: 0.05 }));
});

test("a skip during the title cancels no clip", () => {
  const { h, log } = host(5);
  const f = new Film(h);
  f.start([clip(1, 1)], card);
  f.update(0.5);
  f.cancel();
  assert.deepEqual(log.filter((l) => l.startsWith("cancel")), []);
  assert.equal(log[log.length - 1], "done false");
});

test("no clips, no film; a film does not start twice", () => {
  const { h } = host(1);
  const f = new Film(h);
  assert.equal(f.start([], card), null);
  assert.ok(f.start([clip(1, 1)], card));
  assert.equal(f.start([clip(2, 1)], card), null);
});

test("the film's frames count its own clock", () => {
  const { h } = host(3);
  const f = new Film(h);
  f.start([clip(1, 1)], card, { scale: 0.1, saving: true });
  while (f.active) f.update(FILM.frame);
  assert.ok(Math.abs(f.elapsed - f.frames * FILM.frame) < 1e-9);
  assert.equal(f.saving, true);
});

test("the replay view goes into the film's overlay while a film runs, and to the page otherwise", () => {
  const calls: string[] = [];
  const dom = { show: () => calls.push("show"), bars: (a: number) => calls.push(`bars ${a}`), cover: (a: number) => calls.push(`cover ${a}`), caption: (n: string) => calls.push(`caption ${n}`), speed: () => calls.push("speed") };
  const { h } = host(100);
  const f = new Film(h);
  const v = filmView(f, dom);
  v.bars(1);
  assert.deepEqual(calls, ["bars 1"]);
  calls.length = 0;
  f.start([clip(1, 1)], card, { scale: 0.05 });
  v.bars(0.5);
  v.cover(0.25);
  v.caption("Topple", "text");
  v.speed("1/4");
  assert.deepEqual(calls, []);
  assert.equal(f.overlay.bars, 0.5);
  assert.equal(f.overlay.cover, 0.25);
  assert.deepEqual(f.overlay.caption, { name: "Topple", text: "text" });
  assert.equal(f.overlay.speed, "1/4");
  v.show(true);
  assert.deepEqual(calls, ["show"]);
});

test("the overlay starts empty", () => {
  assert.deepEqual(emptyOverlay(), { bars: 0, cover: 0, caption: null, speed: null, card: null, cardAlpha: 0 });
});

test("photo camera: starts where the camera looks, moves along its view, looks about, zooms inside limits", () => {
  const c = PhotoCam.from({ x: 1, y: 5, z: 2, fx: 0, fy: 0, fz: 1 }, 50);
  assert.ok(Math.abs(c.yaw) < 1e-9 && Math.abs(c.pitch) < 1e-9);
  c.move(1, { x: 0, y: 0, z: 1, fast: false });
  assert.ok(c.z > 2 && Math.abs(c.x - 1) < 1e-9);
  const z1 = c.z;
  c.move(1, { x: 1, y: 0, z: 0, fast: false });
  assert.ok(c.x < 1, "right of +z is -x");
  assert.ok(Math.abs(c.z - z1) < 1e-9);
  c.move(1, { x: 0, y: 1, z: 0, fast: true });
  assert.ok(c.y > 5 + 14 * 3);
  c.look(100, 0);
  assert.ok(c.yaw < 0, "mouse right turns right");
  c.look(0, 100000);
  assert.ok(c.pitch >= -1.5 - 1e-9);
  for (let i = 0; i < 100; i++) c.zoom(-1);
  assert.equal(c.fov, 12);
  for (let i = 0; i < 100; i++) c.zoom(1);
  assert.equal(c.fov, 90);
  const p = c.pose();
  assert.equal(p.mode, "free");
  assert.equal(p.snap, true);
  assert.ok(Math.hypot(p.tx - p.x, p.ty - p.y, p.tz - p.z) > 0.99);
});

test("a step through the clip stays inside the take", () => {
  assert.equal(stepTick(100, 1, 50, 400), 106);
  assert.equal(stepTick(100, -1, 50, 400), 94);
  assert.equal(stepTick(52, -1, 50, 400), 50);
  assert.equal(stepTick(398, 1, 50, 400), 400);
});
