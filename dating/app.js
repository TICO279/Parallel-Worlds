const me = {
  id: "alex",
  name: "Alex",
  age: 26,
  gender: "man",
  job: "Grad student",
  city: "Toronto",
  photo: "photos/alex.jpg",
  verified: true,
  distance: "Your profile",
  lookingFor: "Long-term partner",
  about: "I host dinners that start on time and end when the record does.",
  surpriseKicker: "A surprising thing about me...",
  surprise: "I will plan the whole night and still pretend we just ended up there.",
  weekends: "Cooking",
  saturday: "A long table and one record on repeat",
  sunday: "A slow morning, then the city",
  zodiac: "Taurus",
  education: "Masters",
  height: "5'11\"",
  family: "Open to it",
  interests: [
    { label: "Cooking", hot: true },
    { label: "Records", hot: true },
    { label: "Cities", hot: false },
    { label: "Tennis", hot: false },
  ],
};

// Your own edits on the My profile tab, kept in this browser.
const ME_KEY = "ember.me.v1";
const ME_TEXT = ["name", "gender", "job", "city", "about", "lookingFor", "surprise", "weekends", "saturday", "sunday", "zodiac", "education", "height", "family"];

function applyMe(data) {
  if (!data || typeof data !== "object") return;
  for (const key of ME_TEXT) if (typeof data[key] === "string") me[key] = data[key].trim().slice(0, 400);
  const age = Number(data.age);
  if (Number.isInteger(age) && age >= 18 && age <= 99) me.age = age;
  if (Array.isArray(data.interests)) {
    me.interests = data.interests.filter((label) => typeof label === "string" && label.trim()).slice(0, 12)
      .map((label, index) => ({ label: label.trim().slice(0, 40), hot: index < 2 }));
  }
}

try { applyMe(JSON.parse(localStorage.getItem(ME_KEY) || "null")); } catch { /* storage unavailable: keep the defaults */ }

const profiles = [
  {
    id: "amara",
    name: "Amara",
    age: 23,
    gender: "woman",
    verified: true,
    distance: "2 miles away",
    job: "Gallery assistant",
    photo: "photos/amara.jpg",
    outgoing: true,
    lookingFor: "Long-term partner",
    cardKicker: "I just realized that...",
    cardText: "The best conversations start before anyone checks their phone.",
    about: "I paint bigger than my apartment. If you have a car with a clean trunk, we should talk.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I once traded a painting for six months of coffee.",
    weekends: "Recharging",
    saturday: "A gallery, then late noodles",
    sunday: "A long swim and a sketchbook",
    zodiac: "Aquarius",
    education: "Bachelors",
    height: "5'7\"",
    family: "Open to it",
    interests: [
      { label: "Painting", hot: true },
      { label: "Cooking", hot: true },
      { label: "Indie films", hot: false },
      { label: "Thrifting", hot: false },
      { label: "Dogs", hot: true },
      { label: "Ocean", hot: false },
      { label: "Galleries", hot: false },
    ],
  },
  {
    id: "jordan",
    name: "Jordan",
    age: 27,
    gender: "man",
    verified: true,
    distance: "4 miles away",
    job: "Architect",
    photo: "photos/jordan.jpg",
    outgoing: false,
    lookingFor: "Long-term partner",
    cardKicker: "My simple pleasure...",
    cardText: "A rooftop, a bad skyline, and someone who will argue about both.",
    about: "I notice staircases the way other people notice eyes. Show me a city and I'll find the long way through it.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I can sketch a room from memory, then forget where I parked.",
    weekends: "City walks",
    saturday: "A rooftop, if the wind is kind",
    sunday: "Drawing buildings I can't afford",
    zodiac: "Capricorn",
    education: "Bachelors",
    height: "6'1\"",
    family: "Want someday",
    interests: [
      { label: "Architecture", hot: true },
      { label: "Cities", hot: true },
      { label: "Cooking", hot: false },
      { label: "Running", hot: false },
      { label: "Jazz", hot: true },
    ],
  },
  {
    id: "elena",
    name: "Elena",
    age: 26,
    gender: "woman",
    verified: true,
    distance: "1 mile away",
    job: "Editor",
    photo: "photos/elena.jpg",
    outgoing: true,
    lookingFor: "Long-term partner",
    cardKicker: "I want someone who...",
    cardText: "Will sit on a park bench until the light changes and not call it a plan.",
    about: "Autumn person. I know every bench in the park with decent light, and I will share exactly one of them.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I will reorganize a bookshelf in someone else's house.",
    weekends: "Getting lost",
    saturday: "Dinner that takes all afternoon",
    sunday: "The bench with the good light",
    zodiac: "Virgo",
    education: "Masters",
    height: "5'6\"",
    family: "Not sure yet",
    interests: [
      { label: "Reading", hot: true },
      { label: "Coffee", hot: true },
      { label: "Hiking", hot: false },
      { label: "Film photos", hot: false },
      { label: "Cooking", hot: true },
      { label: "Dogs", hot: false },
    ],
  },
  {
    id: "devin",
    name: "Devin",
    age: 22,
    gender: "man",
    verified: false,
    distance: "3 miles away",
    job: "Musician",
    photo: "photos/devin.jpg",
    outgoing: true,
    lookingFor: "New friends",
    cardKicker: "A surprising thing about me...",
    cardText: "I write the second verse on the subway. Every time.",
    about: "Most of my songs start as a note I was scared to send. The good ones survive the ride home.",
    surpriseKicker: "We'll get along if...",
    surprise: "You stay for the last song even when the room is too loud.",
    weekends: "Shows",
    saturday: "Someone else's set, then ramen",
    sunday: "The verse I avoided all week",
    zodiac: "Pisces",
    education: "In college",
    height: "5'10\"",
    family: "Not sure yet",
    interests: [
      { label: "Guitar", hot: true },
      { label: "Live music", hot: true },
      { label: "Night walks", hot: false },
      { label: "Ramen", hot: true },
      { label: "Photography", hot: false },
    ],
  },
  {
    id: "sofia",
    name: "Sofia",
    age: 27,
    gender: "woman",
    verified: true,
    distance: "5 miles away",
    job: "Painter",
    photo: "photos/sofia.jpg",
    outgoing: false,
    lookingFor: "Not sure yet",
    cardKicker: "I know the best spot in town for...",
    cardText: "Olive oil, and I will judge a kitchen by the bottle on the counter.",
    about: "The studio is a mess and the work is not. If you can handle paint on a sleeve, you're already doing well.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I learned to cook so I would stop eating cereal over the sink.",
    weekends: "The studio",
    saturday: "Jazz and a late table",
    sunday: "The market, then paint on my hands",
    zodiac: "Libra",
    education: "Bachelors",
    height: "5'5\"",
    family: "Don't want",
    interests: [
      { label: "Painting", hot: true },
      { label: "Cooking", hot: true },
      { label: "Jazz", hot: false },
      { label: "Markets", hot: true },
      { label: "Museums", hot: false },
    ],
  },
  {
    id: "leo",
    name: "Leo",
    age: 28,
    gender: "man",
    verified: true,
    distance: "6 miles away",
    job: "Coach",
    photo: "photos/leo.jpg",
    outgoing: false,
    lookingFor: "New friends",
    cardKicker: "My weekends are for...",
    cardText: "An easy five miles, then a very serious breakfast.",
    about: "I run early so the rest of the day can be lazy on purpose. Breakfast is non-negotiable.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I talk to every dog I pass. The owners are optional.",
    weekends: "Miles",
    saturday: "A big breakfast at dinner time",
    sunday: "A slow run and a phone that stays home",
    zodiac: "Aries",
    education: "Bachelors",
    height: "6'0\"",
    family: "Want someday",
    interests: [
      { label: "Running", hot: true },
      { label: "Cooking", hot: true },
      { label: "Dogs", hot: true },
      { label: "Travel", hot: false },
      { label: "Breakfast", hot: false },
    ],
  },
  {
    id: "maya",
    name: "Maya",
    age: 24,
    gender: "woman",
    verified: true,
    distance: "2 miles away",
    job: "Photographer",
    photo: "photos/maya.jpg",
    outgoing: true,
    lookingFor: "Long-term partner",
    cardKicker: "The way to win me over is...",
    cardText: "Take the window seat, and don't rush the second coffee.",
    about: "I shoot film because it makes me stay. One roll, then we actually leave the cafe.",
    surpriseKicker: "A surprising thing about me...",
    surprise: "I can tell you the hour by the color of the light.",
    weekends: "Shooting film",
    saturday: "One roll. One roll only.",
    sunday: "Coffee until the light goes",
    zodiac: "Gemini",
    education: "Bachelors",
    height: "5'4\"",
    family: "Open to it",
    interests: [
      { label: "Film cameras", hot: true },
      { label: "Coffee", hot: true },
      { label: "Travel", hot: false },
      { label: "Cats", hot: true },
      { label: "Walks", hot: false },
    ],
  },
];

const DECK_IDS = ["amara", "jordan", "elena", "devin", "sofia", "leo"];
const INITIAL_LIKES = ["elena", "devin"];
const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));

const state = {
  tab: "discover",
  overlay: null,
  deck: [...DECK_IDS],
  history: [],
  likesIn: [...INITIAL_LIKES],
  likesOut: [],
  passes: [],
  blocked: [],
  matches: ["maya"],
  messages: {
    maya: [
      { from: "them", text: "That cafe on Clinton is dangerous. I went for one coffee and stayed two hours.", time: "2h" },
      { from: "me", text: "Worth it if the window seat was free.", time: "2h" },
      { from: "them", text: "It was. I'm saving you the corner one.", time: "1h" },
    ],
  },
  unread: { maya: 1 },
  pendingMatch: null,
  detailId: null,
  chatId: null,
  sheet: null,
  sheetId: null,
  toast: null,
  animating: false,
};

let toastToken = 0;
let toastTimer = null;
let gesture = null;
let suppressClick = false;

function person(id) {
  return id === me.id ? me : byId[id];
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

const icon = {
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.1 1.8c.3 3.2-1.6 4.8-2.8 6.6-1.2 1.8-1.8 3.1-1.8 5 0 1.2.4 2.2 1.1 2.9-1.3-.8-2.1-2.1-2.1-3.6 0-2.2 1.2-3.9 2.4-5.6.8-1.1 1.5-2.1 1.6-3.6.1-.8-.4-1.4-.7-1.8.7.4 1.6 1.5 2.3.1zM12 22c3.8 0 6.6-2.6 6.6-6.2 0-2.8-1.6-4.8-3-6.6-.5-.6-1.5.1-1.1.8.8 1.5.5 2.6-.5 3.7-.7.8-1.7 1.2-1.5-.9.2-1.8-.8-3.4-1.8-4.7-.4-.5-1.2 0-.9.6.7 1.7.3 3.3-.8 4.6-1.2 1.4-1.8 2.8-1.8 4.3C7.2 19.4 9.2 22 12 22z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5L8 12l7 7"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.4-2.8 7.3-7 9-4.2-1.7-7-4.6-7-9V6l7-3z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
  rewind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2-5.1"/><path d="M4 4.5V9h4.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2l2.4 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.2 7 18.6l1.1-5.6L3.9 9.1l5.7-.7L12 3.2z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 10-14h-7l0-6z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5h14v8.2H8.2L5 17.5V6.5z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  gem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 3l3 5 5 .4-4 4.2 1.2 5.4L12 15.8 6.8 18l1.2-5.4L4 8.4 9 8l3-5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H19"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 15l11-11 5 5L9 20H4v-5z"/><path d="M9 8l2 2M12 5l2 2M6 11l2 2"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="10" r="2.2"/><path d="M4.5 19c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M14 15.2c1.3-.4 2.6-.2 3.6.8 1 .9 1.5 2 1.6 3"/></svg>',
};

icon.pin = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
icon.more = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
icon.rings = '<svg viewBox="0 0 40 26" aria-hidden="true"><circle cx="14" cy="13" r="9.5" fill="none" stroke="#5aa8ff" stroke-width="2.4"/><circle cx="26" cy="13" r="9.5" fill="none" stroke="#ffb547" stroke-width="2.4"/></svg>';

const verifyBadge = '<svg class="verify" viewBox="0 0 24 24" width="18" height="18" aria-label="Verified"><circle cx="12" cy="12" r="10" fill="#3b9cff"/><path d="M7.4 12.2l3 3.1 6.2-6.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function roundBtn(action, label, glyph, cls, extra = "") {
  return `<button type="button" class="round ${cls}" data-action="${action}" aria-label="${label}" ${extra}>${glyph}</button>`;
}

function showToast(message) {
  state.toast = message;
  const root = document.querySelector(".root");
  if (!root) return;
  let el = root.querySelector(".toast");
  if (!el) {
    root.insertAdjacentHTML("beforeend", '<div class="toast" role="status"></div>');
    el = root.querySelector(".toast");
  }
  el.textContent = message;
  const token = ++toastToken;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (token !== toastToken) return;
    state.toast = null;
    document.querySelector(".toast")?.remove();
  }, 1700);
}

function unreadCount() {
  return Object.values(state.unread).reduce((sum, n) => sum + (n || 0), 0);
}

function tabbar() {
  const chats = unreadCount();
  const item = (tab, glyph, label, badge) => `
    <button type="button" class="tab ${state.tab === tab ? "on" : ""}" data-action="tab" data-tab="${tab}" aria-label="${label}">
      ${glyph}
      ${badge ? `<span class="badge">${badge}</span>` : ""}
    </button>`;
  return `<nav class="tabbar">
    ${item("discover", icon.flame, "Discover")}
    ${item("messages", icon.chat, "Messages", chats || "")}
    <button type="button" class="tab ${state.tab === "profile" ? "on" : ""}" data-action="tab" data-tab="profile" aria-label="Profile">
      <img class="tab-avatar" src="${me.photo}" alt="" />
    </button>
  </nav>`;
}

function cardHtml(p, cls) {
  return `<article class="swipe-card ${cls}" data-id="${p.id}">
    <img class="card-photo" src="${p.photo}" alt="${esc(p.name)}" draggable="false" />
    <div class="bars"><span class="on"></span></div>
    <div class="card-shade"></div>
    <div class="stamp like">LIKE</div>
    <div class="stamp nope">NOPE</div>
    <div class="stamp super">SUPER</div>
    <div class="card-info">
      <div class="card-row">
        <h1 class="card-name name-line">${esc(p.name)} <span class="age">${p.age}</span>${p.verified ? verifyBadge : ""}</h1>
        <span class="chev">${icon.chev}</span>
      </div>
      <div class="prompt">
        <div class="kicker">“ ${esc(p.cardKicker)}</div>
        <div class="prompt-text">${esc(p.cardText)}</div>
      </div>
    </div>
  </article>`;
}

function discoverView() {
  const [front, next] = state.deck;
  const empty = !front;
  const stack = empty
    ? `<div class="empty">
        <h2>You've seen everyone nearby</h2>
        <p>Rewind a pass, or look through them again.</p>
        <button type="button" class="solid" data-action="recycle">Review again</button>
      </div>`
    : `${next ? cardHtml(person(next), "next") : ""}${cardHtml(person(front), "top")}`;
  const off = empty ? "disabled" : "";
  return `<div class="deck-view">
    <header class="topbar">
      <div class="brand">${icon.flame}<span class="word">ember</span></div>
    </header>
    <div class="stack">${stack}</div>
    <div class="actions">
      ${roundBtn("rewind", "Rewind", icon.rewind, "sm rewind", state.history.length ? "" : "disabled")}
      ${roundBtn("nope", "Pass", icon.x, "lg nope", off)}
      ${roundBtn("super", "Super like", icon.star, "sm super", off)}
      ${roundBtn("like", "Like", icon.heart, "lg like", off)}
      ${roundBtn("boost", "Boost", icon.bolt, "sm boost")}
    </div>
  </div>`;
}

function preview(id) {
  const msgs = state.messages[id] || [];
  if (!msgs.length) return "You matched. Say hi.";
  const last = msgs[msgs.length - 1];
  return (last.from === "me" ? "You: " : "") + last.text;
}

function threadTime(id) {
  const msgs = state.messages[id] || [];
  if (!msgs.length) return "Now";
  return msgs[msgs.length - 1].time || "Now";
}

function messagesView() {
  const rows = state.matches.filter((id) => person(id) && !state.blocked.includes(id));
  const body = rows.length
    ? rows.map((id) => {
      const p = person(id);
      const unread = state.unread[id];
      return `<button type="button" class="thread-row ${unread ? "unread" : ""}" data-action="open-chat" data-id="${id}">
        <span class="avatar-wrap">
          <img src="${p.photo}" alt="" />
          ${unread ? '<span class="unread-dot"></span>' : ""}
        </span>
        <span class="thread-copy">
          <strong>${esc(p.name)}</strong>
          <em>${esc(preview(id))}</em>
        </span>
        <span class="when">${esc(threadTime(id))}</span>
      </button>`;
    }).join("")
    : `<div class="empty"><h2>No matches yet</h2><p>Like someone back and the chat will land here.</p></div>`;
  return `<div class="scroll-view">
    <header class="topbar center"><h1 class="page-title">Messages</h1></header>
    ${body}
  </div>`;
}

const LOOKING = ["Long-term partner", "Long-term, open to short", "Short-term fun", "New friends", "Not sure yet"];

function field(name, label, value, attrs = "") {
  return `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? "")}" ${attrs} /></label>`;
}

function area(name, label, value) {
  return `<label class="field"><span>${label}</span><textarea name="${name}" rows="3" maxlength="400">${esc(value ?? "")}</textarea></label>`;
}

function profileView() {
  const looking = LOOKING.includes(me.lookingFor) ? LOOKING : [me.lookingFor, ...LOOKING];
  return `<div class="scroll-view">
    <div class="me-hero">
      <img src="${me.photo}" alt="${esc(me.name)}" />
      <div class="me-id">
        <h1 class="name-line">${esc(me.name)} <span class="age">${esc(me.age)}</span>${verifyBadge}</h1>
        <p>${esc(me.job)} · ${esc(me.city)}</p>
        <button type="button" class="ghost" data-action="open-detail" data-id="${me.id}">Preview profile</button>
      </div>
    </div>
    <form class="me-pad me-form" data-action="save-profile">
      <div class="section-label">About me</div>
      <div class="field-row">
        ${field("name", "Name", me.name, 'required maxlength="40" autocomplete="given-name"')}
        ${field("age", "Age", me.age, 'required type="number" min="18" max="99" inputmode="numeric"')}
      </div>
      <div class="field-row">
        ${field("gender", "Gender", me.gender, 'maxlength="24"')}
        ${field("city", "City", me.city, 'maxlength="80"')}
      </div>
      ${field("job", "Work", me.job, 'maxlength="80"')}
      ${area("about", "Bio", me.about)}
      <label class="field"><span>I'm looking for</span><select name="lookingFor">${looking.map((v) => `<option ${v === me.lookingFor ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      ${field("interests", "Interests, separated by commas", me.interests.map((i) => i.label).join(", "), 'maxlength="300"')}
      ${area("surprise", esc(me.surpriseKicker), me.surprise)}
      <div class="section-label">My weekends</div>
      ${field("weekends", "Weekends are for...", me.weekends, 'maxlength="120"')}
      ${field("saturday", "Saturday night looks like...", me.saturday, 'maxlength="160"')}
      ${field("sunday", "A typical Sunday looks like...", me.sunday, 'maxlength="160"')}
      <div class="section-label">Basics</div>
      <div class="field-row">
        ${field("education", "Education", me.education, 'maxlength="80"')}
        ${field("height", "Height", me.height, 'maxlength="24"')}
      </div>
      <div class="field-row">
        ${field("zodiac", "Zodiac", me.zodiac, 'maxlength="40"')}
        ${field("family", "Family plans", me.family, 'maxlength="80"')}
      </div>
      <button type="submit" class="solid save-profile">Save profile</button>
    </form>
  </div>`;
}

function basics(p) {
  const rows = [
    [icon.spark, "Zodiac", p.zodiac],
    [icon.book, "Education", p.education],
    [icon.ruler, "Height", p.height],
    [icon.people, "Family plans", p.family],
  ];
  return rows.map(([glyph, kicker, value]) => `
    <div class="info-row basic">${glyph}<div class="info-value">${esc(value)}</div><div class="info-kicker">${kicker}</div></div>`).join("");
}

function detailView(p) {
  const self = p.id === me.id;
  const matched = state.matches.includes(p.id);
  const actions = self || state.sheet
    ? ""
    : `<div class="profile-actions">
        ${matched
          ? `<button type="button" class="glass-round" data-action="open-chat" data-id="${p.id}" aria-label="Message ${esc(p.name)}">${icon.chat}</button>`
          : `<button type="button" class="glass-round nope" data-action="nope" data-id="${p.id}" aria-label="Pass">${icon.x}</button>`}
        <button type="button" class="pw-orb" data-action="first-date" data-id="${p.id}" aria-label="Simulate a first date with ${esc(p.name)}">
          <span class="orb">${icon.rings}</span><span class="orb-label">Parallel Worlds</span>
        </button>
        <button type="button" class="glass-round like ${matched ? "is-on" : ""}" data-action="like" data-id="${p.id}" aria-label="${matched ? "Matched" : "Like"}" ${matched ? "disabled" : ""}>${icon.heart}</button>
      </div>`;
  return `<div class="detail-view profile-view">
    <div class="detail-scroll">
      <section class="profile-hero">
        <img src="${p.photo}" alt="${esc(p.name)}" />
        <header class="profile-nav">
          <button type="button" class="icon-hit" data-action="back" aria-label="Back">${icon.back}</button>
          ${self ? "<span></span>" : `<button type="button" class="icon-hit" data-action="open-sheet" aria-label="Share, block or report">${icon.more}</button>`}
        </header>
        <div class="profile-id ${self ? "" : "with-actions"}">
          <h1 class="name-line">${esc(p.name)} <span class="age">${esc(p.age)}</span>${p.verified ? verifyBadge : ""}</h1>
          <p class="profile-where">${self ? esc(p.city) : `${icon.pin}${esc(p.distance)}`}</p>
          <div class="profile-pills">${p.interests.slice(0, 4).map((item) => `<span>${esc(item.label)}</span>`).join("")}</div>
        </div>
      </section>
      <div class="pad">
        <p class="distance">${esc(p.job || "")}${p.city && !self ? ` · ${esc(p.city)}` : ""}</p>
        <div class="section-label">About me</div>
        <p class="about">${esc(p.about)}</p>
        <div class="section-label">Looking for</div>
        <div class="look-card"><span class="gem">${icon.gem}</span>${esc(p.lookingFor)}</div>
        <div class="section-label">${esc(p.surpriseKicker)}</div>
        <p class="about">${esc(p.surprise)}</p>
        <div class="section-label">My weekends</div>
        <div class="info-card">
          <div class="info-row"><div class="info-kicker">Weekends are for...</div><div class="info-value">${esc(p.weekends)}</div></div>
          <div class="info-row"><div class="info-kicker">Saturday night looks like...</div><div class="info-value">${esc(p.saturday)}</div></div>
          <div class="info-row"><div class="info-kicker">A typical Sunday looks like...</div><div class="info-value">${esc(p.sunday)}</div></div>
        </div>
        <div class="section-label">Basics</div>
        <div class="info-card">${basics(p)}</div>
      </div>
    </div>
    ${actions}
  </div>`;
}

function chatView() {
  const p = person(state.chatId);
  const msgs = state.messages[p.id] || [];
  return `<div class="chat-view">
    <header class="detail-nav">
      <button type="button" class="icon-hit" data-action="back" aria-label="Back">${icon.back}</button>
      <div class="nav-person">
        <img class="chat-ava" src="${p.photo}" alt="" />
        <strong>${esc(p.name)}</strong>
      </div>
      <button type="button" class="icon-hit" data-action="open-sheet" aria-label="More">${icon.shield}</button>
    </header>
    <div class="thread">
      ${msgs.map((m) => `<div class="bubble ${m.from === "me" ? "me" : "them"}">${esc(m.text)}</div>`).join("")}
    </div>
    <form class="composer" data-action="send-chat">
      <input name="text" maxlength="200" placeholder="Type a message" autocomplete="off" />
      <button type="submit" aria-label="Send">${icon.send}</button>
    </form>
  </div>`;
}

function matchView() {
  const p = person(state.pendingMatch);
  return `<div class="match-view">
    <div class="match-photos">
      <img class="tilt-l" src="${me.photo}" alt="" />
      <span class="heart-badge">${icon.heart}</span>
      <img class="tilt-r" src="${p.photo}" alt="" />
    </div>
    <h2 class="match-title">It's a Match</h2>
    <p class="match-sub">You and ${esc(p.name)} liked each other.</p>
    <form class="match-form" data-action="send-match">
      <input class="match-input" name="text" maxlength="140" placeholder="Say something nice…" autocomplete="off" />
      <button type="submit" class="send-wide">Send</button>
    </form>
    <button type="button" class="linkish" data-action="keep-swiping">Keep Swiping</button>
  </div>`;
}

function sheetHtml() {
  if (!state.sheet) return "";
  if (state.sheet === "report") {
    const reasons = ["Fake profile", "Inappropriate photos", "Harassment", "Spam", "Something else"];
    return `<div class="sheet-backdrop" data-action="close-sheet">
      <div class="sheet" data-sheet>
        ${reasons.map((reason) => `<button type="button" data-action="submit-report">${esc(reason)}</button>`).join("")}
      </div>
      <div class="sheet"><button type="button" class="cancel" data-action="close-sheet">Cancel</button></div>
    </div>`;
  }
  return `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" data-sheet>
      <button type="button" data-action="share">Share</button>
      <button type="button" class="danger" data-action="block">Block</button>
      <button type="button" class="danger" data-action="report">Report</button>
    </div>
    <div class="sheet"><button type="button" class="cancel" data-action="close-sheet">Cancel</button></div>
  </div>`;
}

function mainView() {
  if (state.overlay === "match" && state.pendingMatch) return matchView();
  if (state.overlay === "detail" && state.detailId) return detailView(person(state.detailId));
  if (state.overlay === "chat" && state.chatId) return chatView();
  if (state.tab === "messages") return messagesView();
  if (state.tab === "profile") return profileView();
  return discoverView();
}

function render() {
  const showTabs = !state.overlay;
  document.getElementById("app").innerHTML = `<div class="root">
    ${mainView()}
    ${showTabs ? tabbar() : ""}
    ${sheetHtml()}
    ${state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : ""}
  </div>`;
  document.querySelector(".screen")?.classList.toggle("on-photo", state.overlay === "detail");
  saveState();
  const thread = document.querySelector(".thread");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function removeFromDeck(id) {
  state.deck = state.deck.filter((item) => item !== id);
}

function commitPass(id) {
  removeFromDeck(id);
  state.likesIn = state.likesIn.filter((item) => item !== id);
  if (!state.passes.includes(id)) state.passes.push(id);
  state.history.push({ id, action: "pass" });
}

function commitLike(id, action) {
  // Every like is a match: the point is to get to the first date.
  const matched = true;
  removeFromDeck(id);
  state.passes = state.passes.filter((item) => item !== id);
  state.likesIn = state.likesIn.filter((item) => item !== id);
  state.likesOut = state.likesOut.filter((item) => item !== id);
  if (matched) {
    if (!state.matches.includes(id)) state.matches.unshift(id);
    if (!state.messages[id]) state.messages[id] = [];
    if (state.unread[id] == null) state.unread[id] = 1;
    state.pendingMatch = id;
    state.overlay = "match";
  } else {
    state.likesOut.push(id);
    state.pendingMatch = null;
  }
  state.history.push({ id, action });
  return matched;
}

function likePerson(id, action) {
  if (!id || state.animating || id === me.id) return;
  const matched = commitLike(id, action);
  state.detailId = null;
  state.sheet = null;
  if (!matched) state.overlay = null;
  render();
}

function passPerson(id) {
  if (!id || state.animating || id === me.id) return;
  commitPass(id);
  if (state.detailId === id) {
    state.overlay = null;
    state.detailId = null;
  }
  state.sheet = null;
  render();
}

function fling(dir) {
  if (state.animating || state.overlay) return;
  const id = state.deck[0];
  const card = document.querySelector(".swipe-card.top");
  if (!id || !card) return;
  state.animating = true;
  card.style.transition = "transform .28s ease-in";
  card.style.transform = dir === "left"
    ? "translateX(-140%) rotate(-16deg)"
    : dir === "super"
      ? "translateY(-130%) rotate(-6deg)"
      : "translateX(140%) rotate(16deg)";
  const stamp = card.querySelector(dir === "left" ? ".stamp.nope" : dir === "super" ? ".stamp.super" : ".stamp.like");
  if (stamp) stamp.style.opacity = "1";
  setTimeout(() => {
    state.animating = false;
    if (dir === "left") passPerson(id);
    else likePerson(id, dir === "super" ? "super" : "like");
  }, 280);
}

function openDetail(id) {
  if (!person(id)) return;
  state.detailId = id;
  state.overlay = "detail";
  state.sheet = null;
  state.sheetId = id;
  render();
}

function openChat(id) {
  state.chatId = id;
  state.overlay = "chat";
  state.tab = "messages";
  state.unread[id] = 0;
  state.sheet = null;
  state.sheetId = id;
  render();
}

function rewind() {
  if (state.animating) return;
  const last = state.history.pop();
  if (!last) {
    showToast("Nothing to rewind");
    return;
  }
  const { id } = last;
  state.matches = state.matches.filter((item) => item !== id);
  state.likesOut = state.likesOut.filter((item) => item !== id);
  state.passes = state.passes.filter((item) => item !== id);
  state.blocked = state.blocked.filter((item) => item !== id);
  if (state.pendingMatch === id) state.pendingMatch = null;
  if (INITIAL_LIKES.includes(id) && !state.likesIn.includes(id)) state.likesIn.push(id);
  if (state.messages[id] && state.messages[id].length === 0) delete state.messages[id];
  delete state.unread[id];
  if (!state.deck.includes(id)) state.deck.unshift(id);
  state.overlay = null;
  state.tab = "discover";
  render();
}

function recycle() {
  state.deck = DECK_IDS.filter((id) => !state.matches.includes(id) && !state.blocked.includes(id));
  state.passes = state.passes.filter((id) => !state.deck.includes(id));
  state.likesOut = state.likesOut.filter((id) => !state.deck.includes(id));
  if (!state.deck.length) showToast("You're all caught up");
  else render();
}

// Matches and chats survive the trip to the date screen and back.
const STATE_KEY = "ember.state.v1";
const SAVED = ["matches", "messages", "unread", "passes", "likesOut", "likesIn", "blocked"];

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.fromEntries(SAVED.map((key) => [key, state[key]])))); } catch { /* memory only */ }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    for (const key of SAVED) {
      const value = saved[key];
      if (key === "messages" || key === "unread" ? value && typeof value === "object" && !Array.isArray(value) : Array.isArray(value)) state[key] = value;
    }
    const gone = new Set([...state.matches, ...state.passes, ...state.likesOut, ...state.blocked]);
    state.deck = DECK_IDS.filter((id) => !gone.has(id));
  } catch { /* start fresh */ }
}

function saveMe() {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ ...Object.fromEntries(ME_TEXT.map((key) => [key, me[key]])), age: me.age, interests: me.interests.map((i) => i.label) }));
  } catch { /* the date still gets her profile, just not yours */ }
}

/** The first date: her profile in the URL; yours is read from this browser by the date screen. */
function startDate(id) {
  const p = person(id);
  if (!p) return;
  saveMe();
  const params = new URLSearchParams();
  const set = (key, value) => { if (value != null && value !== "") params.set(key, String(value)); };
  set("partner", p.name);
  set("from", p.id);
  set("opens", p.outgoing ? "1" : "0");
  set("age", p.age);
  set("gender", p.gender);
  set("job", p.job);
  set("city", p.city);
  set("about", p.about);
  set("prompt", p.cardText || p.surprise);
  set("promptKicker", p.cardKicker || p.surpriseKicker);
  set("looking", p.lookingFor);
  set("distance", p.distance);
  set("education", p.education);
  set("height", p.height);
  set("zodiac", p.zodiac);
  set("family", p.family);
  set("weekends", p.weekends);
  set("saturday", p.saturday);
  set("sunday", p.sunday);
  set("surprise", p.surprise);
  if (p.interests?.length) set("interests", p.interests.map((item) => item.label).filter(Boolean).join(", "));
  if (p.photo) set("photo", new URL(p.photo, window.location.href).pathname);
  window.location.assign(`/practice/?${params}`);
}

function closeSheet() {
  state.sheet = null;
  document.querySelector(".sheet-backdrop")?.remove();
}

const handlers = {
  "first-date"(btn) { startDate(btn.dataset.id); },
  tab(btn) {
    state.tab = btn.dataset.tab;
    state.overlay = null;
    state.sheet = null;
    render();
  },
  "open-detail"(btn) { openDetail(btn.dataset.id || state.deck[0]); },
  "open-chat"(btn) { openChat(btn.dataset.id); },
  back() {
    state.overlay = null;
    state.sheet = null;
    state.pendingMatch = null;
    render();
  },
  like(btn) {
    if (btn.dataset.id) likePerson(btn.dataset.id, "like");
    else fling("right");
  },
  super(btn) {
    if (btn.dataset.id) likePerson(btn.dataset.id, "super");
    else fling("super");
  },
  nope(btn) {
    if (btn.dataset.id) passPerson(btn.dataset.id);
    else fling("left");
  },
  rewind,
  boost() { showToast("You're at the top for 30 minutes"); },
  recycle,
  "open-sheet"() {
    state.sheet = "menu";
    state.sheetId = state.overlay === "chat" ? state.chatId : state.detailId;
    render();
  },
  "close-sheet": closeSheet,
  share() {
    const p = person(state.sheetId);
    const text = `${p.name}, ${p.age} on Ember`;
    navigator.clipboard?.writeText(text).catch(() => {});
    closeSheet();
    showToast("Profile link copied");
  },
  block() {
    const id = state.sheetId;
    state.sheet = null;
    if (id && id !== me.id) {
      removeFromDeck(id);
      state.likesIn = state.likesIn.filter((item) => item !== id);
      state.matches = state.matches.filter((item) => item !== id);
      if (!state.blocked.includes(id)) state.blocked.push(id);
      state.history.push({ id, action: "block" });
    }
    state.overlay = null;
    render();
    showToast("Blocked");
  },
  report() {
    state.sheet = "report";
    render();
  },
  "submit-report"() {
    const id = state.sheetId;
    state.sheet = null;
    if (id && id !== me.id) {
      removeFromDeck(id);
      state.likesIn = state.likesIn.filter((item) => item !== id);
      state.matches = state.matches.filter((item) => item !== id);
      if (!state.passes.includes(id)) state.passes.push(id);
      state.history.push({ id, action: "pass" });
    }
    state.overlay = null;
    render();
    showToast("Report submitted");
  },
  "keep-swiping"() {
    state.overlay = null;
    state.pendingMatch = null;
    state.tab = "discover";
    render();
  },
};

function sendChat() {
  const input = document.querySelector(".composer input");
  const text = input?.value.trim();
  if (!text || !state.chatId) return;
  if (!state.messages[state.chatId]) state.messages[state.chatId] = [];
  state.messages[state.chatId].push({ from: "me", text, time: "Now" });
  render();
}

function sendMatch() {
  const input = document.querySelector(".match-input");
  const text = input?.value.trim();
  const id = state.pendingMatch;
  if (!text) {
    showToast("Write a quick hello");
    return;
  }
  if (!state.messages[id]) state.messages[id] = [];
  state.messages[id].push({ from: "me", text, time: "Now" });
  state.unread[id] = 0;
  state.pendingMatch = null;
  state.chatId = id;
  state.tab = "messages";
  state.overlay = "chat";
  render();
}

function onClick(event) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (event.target.closest("[data-sheet]")) event.stopPropagation();
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  if (btn.closest(".sheet-backdrop") && btn.dataset.action === "close-sheet" && event.target.closest("[data-sheet]")) return;
  const action = btn.dataset.action;
  handlers[action]?.(btn, event);
}

function saveProfile(form) {
  const data = Object.fromEntries(new FormData(form));
  if (!data.name.trim()) { showToast("Add your name"); return; }
  data.interests = String(data.interests || "").split(",");
  applyMe(data);
  saveMe();
  render();
  showToast("Profile saved");
}

function onSubmit(event) {
  event.preventDefault();
  if (event.target.dataset.action === "save-profile") saveProfile(event.target);
  if (event.target.dataset.action === "send-chat") sendChat();
  if (event.target.dataset.action === "send-match") sendMatch();
}

function onPointerDown(event) {
  const card = event.target.closest(".swipe-card.top");
  if (!card || state.animating || state.overlay) return;
  if (event.target.closest("button, input, a")) return;
  event.preventDefault();
  card.setPointerCapture?.(event.pointerId);
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, card };
}

function onPointerMove(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  gesture.dx = event.clientX - gesture.x;
  gesture.dy = event.clientY - gesture.y;
  const { card, dx, dy } = gesture;
  card.style.transition = "none";
  card.style.transform = `translate(${dx}px, ${dy * 0.12}px) rotate(${dx / 18}deg)`;
  const like = card.querySelector(".stamp.like");
  const nope = card.querySelector(".stamp.nope");
  if (like) like.style.opacity = dx > 0 ? String(Math.min(1, dx / 110)) : "0";
  if (nope) nope.style.opacity = dx < 0 ? String(Math.min(1, -dx / 110)) : "0";
  const next = document.querySelector(".swipe-card.next");
  if (next) {
    const progress = Math.min(1, Math.abs(dx) / 140);
    next.style.transform = `scale(${0.96 + progress * 0.04})`;
  }
}

function onPointerUp(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  const { card, dx, dy } = gesture;
  gesture = null;
  suppressClick = true;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 12 && absY < 12) {
    card.style.transition = "";
    card.style.transform = "";
    openDetail(state.deck[0]);
    return;
  }
  if (dy < -90 && absY > absX) {
    card.style.transition = "transform .2s ease";
    card.style.transform = "";
    openDetail(state.deck[0]);
    return;
  }
  if (dx > 110) return fling("right");
  if (dx < -110) return fling("left");
  card.style.transition = "transform .22s ease";
  card.style.transform = "";
  const next = document.querySelector(".swipe-card.next");
  if (next) next.style.transform = "";
}

function onKey(event) {
  const typing = document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if (event.key === "Escape") {
    if (state.sheet) { closeSheet(); return; }
    if (state.overlay) { state.overlay = null; state.pendingMatch = null; render(); }
    return;
  }
  if (typing || state.overlay || state.sheet || state.tab !== "discover") return;
  if (event.key === "ArrowLeft") { event.preventDefault(); fling("left"); }
  if (event.key === "ArrowRight") { event.preventDefault(); fling("right"); }
  if (event.key === "ArrowUp") { event.preventDefault(); if (state.deck[0]) openDetail(state.deck[0]); }
  if (event.key === "ArrowDown") { event.preventDefault(); fling("super"); }
}

const app = document.getElementById("app");
app.addEventListener("click", onClick);
app.addEventListener("submit", onSubmit);
app.addEventListener("pointerdown", onPointerDown);
app.addEventListener("pointermove", onPointerMove);
app.addEventListener("pointerup", onPointerUp);
app.addEventListener("pointercancel", onPointerUp);
document.addEventListener("keydown", onKey);
loadState();
const back = /^#profile=([a-z]+)$/.exec(window.location.hash)?.[1];
if (back && byId[back]) {
  state.detailId = back;
  state.sheetId = back;
  state.overlay = "detail";
  history.replaceState(null, "", window.location.pathname);
}
render();
