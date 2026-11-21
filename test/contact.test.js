const test = require("node:test");
const assert = require("node:assert");
const { validateContact, formatContactAlert, createRateLimiter } = require("../lib/contact");
const { createServer } = require("../server");

const good = { topic: "interview", name: "홍길동", contact: "010-1234-5678", org: "", message: "출연하고 싶습니다. 관세사예요.", agree: true };

test("올바른 문의는 통과한다", () => {
  const r = validateContact(good);
  assert.equal(r.ok, true);
  assert.equal(r.data.name, "홍길동");
});

test("이메일 연락처도 받는다", () => {
  assert.equal(validateContact({ ...good, contact: "a@b.co" }).ok, true);
});

test("빠진 항목이나 잘못된 값은 막는다", () => {
  assert.equal(validateContact({ ...good, topic: "x" }).ok, false);
  assert.equal(validateContact({ ...good, name: " " }).ok, false);
  assert.equal(validateContact({ ...good, contact: "전화 주세요" }).ok, false);
  assert.equal(validateContact({ ...good, message: "hi" }).ok, false);
  assert.equal(validateContact({ ...good, message: "가".repeat(2001) }).ok, false);
  assert.equal(validateContact({ ...good, agree: false }).ok, false);
  assert.equal(validateContact(null).ok, false);
});

test("알림 문구에 문의 종류와 연락처가 들어간다", () => {
  const text = formatContactAlert(validateContact({ ...good, org: "OO관세법인" }).data);
  assert.match(text, /여강해인터뷰 출연 문의/);
  assert.match(text, /소속: OO관세법인/);
  assert.match(text, /010-1234-5678/);
});

test("같은 주소에서 너무 많이 보내면 막는다", () => {
  const allow = createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(allow("ip", 0), true);
  assert.equal(allow("ip", 1), true);
  assert.equal(allow("ip", 2), false);
  assert.equal(allow("ip", 1500), true);
});

async function withServer(opts, fn) {
  const server = createServer(opts);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const post = (base, body) => fetch(`${base}/api/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("문의를 보내면 알림이 간다", async () => {
  const sent = [];
  await withServer({ canNotify: () => true, notify: async (t) => { sent.push(t); return true; } }, async (base) => {
    const res = await post(base, good);
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
  });
});

test("자동 프로그램(숨은 칸 채움)은 알림 없이 넘긴다", async () => {
  const sent = [];
  await withServer({ canNotify: () => true, notify: async (t) => { sent.push(t); return true; } }, async (base) => {
    const res = await post(base, { ...good, website: "spam" });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 0);
  });
});

test("알림 설정이 없으면 접수했다고 속이지 않는다", async () => {
  await withServer({ canNotify: () => false, notify: async () => true }, async (base) => {
    const res = await post(base, good);
    assert.equal(res.status, 503);
  });
});

test("첫 화면과 처리방침이 열리고, 폴더 밖 파일은 못 연다", async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/privacy`)).status, 200);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.notEqual((await fetch(`${base}/..%2fserver.js`)).status, 200);
  });
});

test("홈페이지에 '소개팅' 표현이 없다", () => {
  const fs = require("fs");
  const path = require("path");
  for (const f of ["index.html", "privacy.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8");
    assert.doesNotMatch(html, /소개팅|데이팅/);
  }
});

test("타임마켓 로고와 앱 화면이 열리고, timemrkt.com으로 연결된다", async () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /https:\/\/timemrkt\.com/);
  await withServer({}, async (base) => {
    for (const f of ["logo.svg", "signup.webp", "home.webp", "list.webp"]) {
      const res = await fetch(`${base}/timemarket/${f}`);
      assert.equal(res.status, 200, f);
      if (f.endsWith(".webp")) assert.equal(res.headers.get("content-type"), "image/webp");
    }
  });
});

test("팀 소개: CEO 여동호와 AI 임원진 10명(이름 Claude)이 있다", async () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /id="team"/);
  assert.match(html, /여동호/);
  assert.equal((html.match(/class="ai"/g) || []).length, 10);
  for (const role of ["CTO", "CSO", "CMO", "CISO", "CPO", "CFO", "COO", "PD", "작가", "SNS"]) {
    assert.match(html, new RegExp(`<span class="ai-role">${role}</span><b>Claude</b>`));
  }
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/team/bill.jpg`)).status, 200);
    assert.equal((await fetch(`${base}/team/ai-avatar.svg`)).status, 200);
  });
});
