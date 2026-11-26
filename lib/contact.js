// 협업 문의 검사와 알림 문구 만들기.
// 문의 내용은 서버에 저장하지 않고 텔레그램 알림으로만 전달합니다(개인정보를 쌓아 두지 않기 위해).

const TOPICS = {
  interview: "여강해인터뷰 출연 문의",
  class: "강의·교육 문의",
  partner: "제휴·협업 제안",
  ir: "투자(IR) 문의",
  waitlist: "타임마켓 출시 알림 신청",
  etc: "기타 문의",
};

const LIMITS = { name: 30, contact: 100, org: 60, message: 2000 };

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cleanMessage = (v) => String(v ?? "").replace(/\r\n?/g, "\n").trim();

// 이메일 또는 휴대폰 번호(숫자 9~12자리)만 받습니다.
function isContact(v) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return true;
  const digits = v.replace(/[\s-]/g, "");
  return /^\+?\d{9,13}$/.test(digits);
}

// 통과하면 { ok: true, data }, 아니면 { ok: false, error: 사용자에게 보여줄 문장 }
function validateContact(body) {
  const b = body && typeof body === "object" ? body : {};
  const data = {
    topic: clean(b.topic),
    name: clean(b.name),
    contact: clean(b.contact),
    org: clean(b.org),
    message: cleanMessage(b.message),
    agree: b.agree === true || b.agree === "on" || b.agree === "true",
  };
  if (!TOPICS[data.topic]) return { ok: false, error: "문의 종류를 골라 주세요." };
  if (!data.name) return { ok: false, error: "이름을 적어 주세요." };
  if (data.name.length > LIMITS.name) return { ok: false, error: `이름은 ${LIMITS.name}자 안으로 적어 주세요.` };
  if (!data.contact || !isContact(data.contact) || data.contact.length > LIMITS.contact) {
    return { ok: false, error: "답장 받을 이메일이나 휴대폰 번호를 정확히 적어 주세요." };
  }
  if (data.org.length > LIMITS.org) return { ok: false, error: `소속은 ${LIMITS.org}자 안으로 적어 주세요.` };
  if (data.message.length < 5) return { ok: false, error: "문의 내용을 조금 더 적어 주세요." };
  if (data.message.length > LIMITS.message) return { ok: false, error: `문의 내용은 ${LIMITS.message}자 안으로 적어 주세요.` };
  if (!data.agree) return { ok: false, error: "개인정보 수집·이용에 동의해 주셔야 문의를 보낼 수 있어요." };
  return { ok: true, data };
}

function formatContactAlert(d) {
  return [
    `${d.topic === "ir" ? "📈 " : ""}[인타임 홈페이지] 새 문의: ${TOPICS[d.topic]}`,
    `이름: ${d.name}`,
    d.org ? `소속: ${d.org}` : null,
    `연락처: ${d.contact}`,
    "",
    d.message,
  ].filter((l) => l !== null).join("\n");
}

// 같은 주소에서 짧은 시간에 너무 많이 보내는 것을 막습니다(메모리에만 기록).
function createRateLimiter({ max = 5, windowMs = 60 * 60 * 1000 } = {}) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return true;
  };
}

module.exports = { TOPICS, validateContact, formatContactAlert, createRateLimiter };
