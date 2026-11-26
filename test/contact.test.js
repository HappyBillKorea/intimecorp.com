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

test("팀 소개: CEO 여강해와 AI 임원진 10명(이름 Claude)이 있다", async () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /id="team"/);
  assert.match(html, /<h3>여강해 <small>Bill<\/small><\/h3>/);
  assert.doesNotMatch(html, /여동호/);
  assert.equal((html.match(/class="ai"/g) || []).length, 10);
  for (const role of ["CTO", "CSO", "CMO", "CISO", "CPO", "CFO", "COO", "PD", "작가", "SNS"]) {
    assert.match(html, new RegExp(`<span class="ai-role">${role}</span><b>Claude</b>`));
  }
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/team/bill.jpg`)).status, 200);
    assert.equal((await fetch(`${base}/team/ai-avatar.svg`)).status, 200);
  });
});

test("AI 임원 카드마다 역할과 비전 내용이 있고, 누르면 열 창이 있다", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.equal((html.match(/class="ai-btn"/g) || []).length, 10);
  assert.equal((html.match(/<template><p class="dlg-k">맡은 일<\/p>/g) || []).length, 10);
  assert.equal((html.match(/앞으로의 비전/g) || []).length, 10);
  assert.match(html, /<dialog class="ai-dlg" id="aiDlg"/);
});

test("링크 미리보기(오픈그래프) 이미지가 있고 열린다", async () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /<meta property="og:image" content="https:\/\/intimecorp\.com\/og\.png/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/og.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
  });
});

test("여강해인터뷰는 '사람과 삶에 대한 이야기'로 소개하고 직업 중심 문구는 쓰지 않는다", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /유튜브 · 사람과 삶에 대한 이야기/);
  assert.doesNotMatch(html, /직업/);
});

test("IR 카드와 투자자 안내 창이 있고, 투자 문의·출시 알림 신청을 받는다", () => {
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /id="ir"/);
  assert.match(html, /id="irOpen"/);
  assert.match(html, /<dialog class="ai-dlg ir-dlg" id="irDlg"/);
  for (const t of ["왜 지금", "왜 우리", "사업 3개", "2027년 1월 출시 예정"]) assert.ok(html.includes(t), t);
  assert.match(html, /data-topic="ir"/);
  assert.match(html, /data-topic="waitlist"/);
  assert.match(html, /<option value="ir">/);
  // IR 자료(PDF)는 공개하지 않는다
  assert.doesNotMatch(html, /\.pdf/i);

  const ir = validateContact({ ...good, topic: "ir", message: "투자 검토를 위해 자료를 받고 싶습니다." });
  assert.equal(ir.ok, true);
  assert.match(formatContactAlert(ir.data), /투자\(IR\) 문의/);
  assert.equal(validateContact({ ...good, topic: "waitlist", message: "출시되면 알려 주세요." }).ok, true);
});
