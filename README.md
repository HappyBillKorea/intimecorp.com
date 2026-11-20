# intimecorp.com — 인타임 주식회사 홈페이지

회사 소개(사업 3개: 타임마켓, 여강해인터뷰, 바이브 코딩 클래스)와 협업 문의 양식이 있는 한 페이지 홈페이지입니다.

## 구성
- `public/index.html` 첫 화면 (문구 수정은 여기서)
- `public/privacy.html` 문의 양식용 개인정보 처리방침
- `public/style.css` 디자인
- `server.js` 화면을 보여 주고, 문의(`/api/contact`)를 텔레그램으로 전달하는 서버 (외부 패키지 없음)
- 문의 내용은 서버에 저장하지 않습니다.

## 실행·확인
```
npm start   # http://localhost:3000
npm test
```

## Railway 배포 때 넣을 값 (Variables)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: 문의 알림을 받을 텔레그램. 없으면 문의 양식이 "지금은 받을 수 없어요"로 안내합니다.
- `SITE_URL` (선택): 기본 https://intimecorp.com

## 법인 설립 후 할 일
- `public/index.html` 바닥글의 주석(대표이사·사업자등록번호·통신판매업 신고번호·주소·이메일) 채우고 주석 풀기
- `public/privacy.html` 7번 담당자 성명·연락처 채우기
