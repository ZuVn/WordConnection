'use strict';



const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // Không có .env thì dùng biến môi trường sẵn có
}

const config = {
  token: process.env.TOKEN,
  channelId: process.env.CHANNEL_ID || '1507509194482389143',
  opponentId: process.env.OPPONENT_ID || null,
  refereeId: process.env.REFEREE_ID || null,
  refereeName: /glitch\s*bucket/i,
  dictPath: process.env.DICT_PATH || path.join(__dirname, 'Word_to_connect.txt'),
  // Từ bị trọng tài ❓ (không có trong từ điển), đã xoá khỏi từ điển
  rejectedPath: path.join(__dirname, 'x_word.txt'),
  // Thời gian "suy nghĩ" giả lập người gõ (ms)
  minDelay: Number(process.env.MIN_DELAY ?? 2500),
  maxDelay: Number(process.env.MAX_DELAY ?? 6000),
  // Số lần đổi từ tối đa trong một lượt khi bị ❓/❌ (mỗi lần sai bị trừ điểm)
  maxRetries: 3,
};

if (!config.token) {
  console.error('Thiếu TOKEN. Tạo file .env theo mẫu .env.example');
  process.exit(1);
}

const START_PHRASE = 'lượt nối từ mới đã bắt đầu với từ';
const NOT_IN_DICT_PHRASE = 'bạn đã sử dụng một từ không có trong từ điển';
// ✅ từ hợp lệ, ❕ từ hợp lệ và hiểm hóc
const OK_EMOJIS = new Set(['✅', '❕']);
const BAD_EMOJI = '❌';
const UNKNOWN_EMOJI = '❓';

const log = (...args) => console.log(...args);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = () => config.minDelay + Math.random() * (config.maxDelay - config.minDelay);
// So sánh thứ tự tin nhắn theo snowflake
const isNewer = (a, b) => BigInt(a) > BigInt(b);

function normalize(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[*_`~|>"“”'‘’«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Trả về cụm 2 âm tiết nếu tin nhắn đúng là một từ nối, ngược lại null
function asWord(content) {
  const text = normalize(content);
  if (!/^[\p{L}]+ [\p{L}]+$/u.test(text)) return null;
  return text;
}

const firstSyl = w => w.slice(0, w.indexOf(' '));
const lastSyl = w => w.slice(w.indexOf(' ') + 1);

/* ---------------- Từ điển ---------------- */

const rejected = new Set(
  fs.existsSync(config.rejectedPath)
    ? fs.readFileSync(config.rejectedPath, 'utf8').split('\n').map(normalize).filter(Boolean)
    : [],
);

const words = [
  ...new Set(
    fs
      .readFileSync(config.dictPath, 'utf8')
      .split('\n')
      .map(normalize)
      .filter(w => asWord(w) && !rejected.has(w)),
  ),
];
const dictionary = new Set(words);

// Âm tiết đầu -> danh sách từ
const byFirst = new Map();
for (const w of words) {
  const s = firstSyl(w);
  if (!byFirst.has(s)) byFirst.set(s, []);
  byFirst.get(s).push(w);
}


/* ---------------- Trạng thái ván ---------------- */

const game = {
  used: new Set(),
  // Số từ chưa dùng bắt đầu bằng mỗi âm tiết
  degree: new Map(),
  // Từ cuối cùng hợp lệ của chuỗi, và tin nhắn chứa nó
  lastWord: null,
  lastMsgId: '0',
  // Đến lượt mình chưa (từ cuối là của đối thủ hoặc từ khởi đầu của trọng tài)
  ourTurn: false,
  // Từ mình vừa gửi, đang chờ trọng tài chấm: { msgId, word, prevWord }
  pending: null,
  retries: 0,
  busy: false,
};

function resetGame() {
  game.used.clear();
  game.degree = new Map([...byFirst].map(([s, list]) => [s, list.length]));
  game.lastWord = null;
  game.ourTurn = false;
  game.pending = null;
  game.retries = 0;
}

function markUsed(word) {
  if (game.used.has(word)) return;
  game.used.add(word);
  if (dictionary.has(word)) {
    const s = firstSyl(word);
    game.degree.set(s, (game.degree.get(s) ?? 1) - 1);
  }
}

function unmarkUsed(word) {
  if (!game.used.delete(word)) return;
  if (dictionary.has(word)) {
    const s = firstSyl(word);
    game.degree.set(s, (game.degree.get(s) ?? 0) + 1);
  }
}

// Ghi đè file qua file tạm để không bị hỏng nếu bot tắt giữa chừng
function writeFileSafe(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

// Xoá một dòng khỏi file danh sách từ
function removeLine(file, word) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  writeFileSafe(file, lines.filter(line => normalize(line) !== word).join('\n'));
}

// Thêm một dòng vào cuối file (bỏ qua nếu đã có), tự chèn xuống dòng nếu file chưa kết thúc bằng \n
function appendLine(file, word) {
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (content.split('\n').some(line => normalize(line) === word)) return;
  const sep = content && !content.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${sep}${word}\n`);
}

// Từ của đối thủ được ✅ mà chưa có trong từ điển: thêm vào (và gỡ khỏi x_word.txt nếu có)
function learnWord(word) {
  if (dictionary.has(word)) return;
  dictionary.add(word);
  const s = firstSyl(word);
  if (!byFirst.has(s)) byFirst.set(s, []);
  byFirst.get(s).push(word);
  if (!game.used.has(word)) game.degree.set(s, (game.degree.get(s) ?? 0) + 1);
  appendLine(config.dictPath, word);

  if (rejected.delete(word)) removeLine(config.rejectedPath, word);
  log(`   + ${word} → Word_to_connect.txt`);
}

// Xoá từ khỏi từ điển (cả file) và ghi vào x_word.txt
function rejectWord(word) {
  if (rejected.has(word)) return;
  rejected.add(word);
  appendLine(config.rejectedPath, word);
  log(`   ❓ ${word} → x_word.txt`);

  if (dictionary.delete(word)) {
    const s = firstSyl(word);
    const list = byFirst.get(s);
    list.splice(list.indexOf(word), 1);
    if (!game.used.has(word)) game.degree.set(s, game.degree.get(s) - 1);
    removeLine(config.dictPath, word);
  }
}

const deg = s => game.degree.get(s) ?? 0;
const available = (syl, exclude = []) =>
  (byFirst.get(syl) ?? []).filter(w => !game.used.has(w) && !exclude.includes(w));

// Số từ chưa dùng bắt đầu bằng syl, không tính các từ trong exclude
function remaining(syl, exclude) {
  let n = deg(syl);
  for (const x of new Set(exclude)) {
    if (firstSyl(x) === syl && dictionary.has(x) && !game.used.has(x)) n--;
  }
  return n;
}

/*
 * Chọn nước đi để thắng (GlitchBucket kết thúc ván khi không còn từ nối được,
 * người nối từ cuối được thưởng điểm).
 *
 * Với mỗi ứng viên w (s -> t):
 *   - Nếu không còn từ nào bắt đầu bằng t: thắng ngay.
 *   - Ngược lại xét mọi câu trả lời r (t -> u) của đối thủ:
 *       * r là "từ chặn" (u không còn từ nối) => đối thủ thắng, phạt nặng.
 *       * sau r mình không có từ chặn nào => phạt vừa.
 *   - Ưu tiên ít lựa chọn cho đối thủ.
 */
function chooseMove(prevWord, exclude = []) {
  const candidates = available(lastSyl(prevWord), exclude);
  if (!candidates.length) return null;

  let best = [];
  let bestScore = -Infinity;

  // Các từ có thể là "từ chặn" xuất phát từ âm tiết u (cache trong một lần chọn)
  const killerCache = new Map();
  const nearKillers = u => {
    if (!killerCache.has(u)) killerCache.set(u, available(u).filter(v => deg(lastSyl(v)) <= 3));
    return killerCache.get(u);
  };

  for (const w of candidates) {
    const t = lastSyl(w);
    // Từ chính w có thể cũng bắt đầu bằng t (vd "xa xa")
    const replies = available(t, [w]);
    let score;

    if (!replies.length) {
      score = 1e6;
    } else {
      let opponentKills = 0;
      let noKillForUs = 0;
      for (const r of replies) {
        const u = lastSyl(r);
        if (remaining(u, [w, r]) === 0) {
          opponentKills++;
          continue;
        }
        const weKill = nearKillers(u).some(v => v !== w && v !== r && remaining(lastSyl(v), [w, r, v]) === 0);
        if (!weKill) noKillForUs++;
      }
      score = -1000 * opponentKills - 10 * noKillForUs - replies.length;
    }

    if (score > bestScore) {
      bestScore = score;
      best = [w];
    } else if (score === bestScore) {
      best.push(w);
    }
  }

  return best[Math.floor(Math.random() * best.length)];
}

/* ---------------- Discord ---------------- */

const client = new Client();

function isReferee(user) {
  if (!user) return false;
  if (config.refereeId) return user.id === config.refereeId;
  return Boolean(user.bot && config.refereeName.test(user.username));
}

function isOpponent(user) {
  if (!user || user.id === client.user.id || user.bot) return false;
  return config.opponentId ? user.id === config.opponentId : true;
}

function messageText(message) {
  const parts = [message.content];
  for (const e of message.embeds) {
    parts.push(e.title, e.description, e.author?.name);
    for (const f of e.fields) parts.push(f.name, f.value);
  }
  return parts.filter(Boolean).join('\n');
}

// Lấy từ khởi đầu phía sau "Lượt nối từ mới đã bắt đầu với từ"
function parseStartWord(message) {
  const text = normalize(messageText(message));
  const idx = text.indexOf(START_PHRASE);
  if (idx === -1) return null;
  const match = text.slice(idx + START_PHRASE.length).match(/^[\s:]*([\p{L}]+ [\p{L}]+)/u);
  return match ? match[1] : null;
}

// Lấy từ trong ngoặc phía sau "Bạn đã sử dụng một từ không có trong từ điển (...)"
function parseNotInDictWord(message) {
  const text = normalize(messageText(message));
  const idx = text.indexOf(NOT_IN_DICT_PHRASE);
  if (idx === -1) return null;
  const match = text.slice(idx + NOT_IN_DICT_PHRASE.length).match(/\(([^)]*)\)/);
  return match ? asWord(match[1]) : null;
}

// Tin nhắn lấy từ lịch sử có reaction này không (trong channel chỉ có trọng tài react)
const hasReaction = (message, ...emojis) =>
  message.reactions.cache.some(r => emojis.includes(r.emoji.name?.replace('\uFE0F', '')));

/* ---------------- Lượt chơi ---------------- */

async function play() {
  if (game.busy || !game.ourTurn || !game.lastWord) return;
  game.busy = true;
  const channel = client.channels.cache.get(config.channelId);
  const prevWord = game.lastWord;

  try {
    await sleep(game.retries ? 1500 + Math.random() * 1500 : randomDelay());
    // Trong lúc chờ có thể đối thủ đã nối trước hoặc ván đã reset
    if (game.lastWord !== prevWord || !game.ourTurn) return;

    const word = chooseMove(prevWord);
    if (!word) {
      log(`   (hết từ nối với "${prevWord}")`);
      game.ourTurn = false;
      return;
    }

    await channel.sendTyping().catch(() => null);
    await sleep(600 + word.length * 90);
    if (game.lastWord !== prevWord || !game.ourTurn) return;

    const sent = await channel.send(word);
    markUsed(word);
    game.ourTurn = false;
    game.pending = { msgId: sent.id, word, prevWord };
    const ends = available(lastSyl(word)).length === 0;
    log(`   Mình:    ${word}${ends ? '  ← từ chặn' : ''}`);
  } catch (err) {
    console.error('Lỗi khi gửi từ:', err);
  } finally {
    game.busy = false;
    // Từ cuối đổi trong lúc mình đang "suy nghĩ": đánh lại với từ mới
    if (game.ourTurn && game.lastWord && game.lastWord !== prevWord) setImmediate(play);
  }
}

function startRound(word, message) {
  resetGame();
  markUsed(word);
  game.lastWord = word;
  game.lastMsgId = message.id;
  game.ourTurn = true;
}

// Từ của đối thủ được ✅
function acceptOpponentWord(word, message) {
  if (!isNewer(message.id, game.lastMsgId)) return false;
  log(`   Đối thủ: ${word}`);
  markUsed(word);
  game.lastWord = word;
  game.lastMsgId = message.id;
  game.ourTurn = true;
  game.pending = null;
  game.retries = 0;
  return true;
}

// Từ của mình bị ❓ hoặc ❌: đổi sang từ khác, nối tiếp từ trước đó
function rejectOurWord(emoji) {
  const { word, prevWord } = game.pending;
  game.pending = null;

  if (emoji === UNKNOWN_EMOJI) {
    // Không có trong từ điển trọng tài: xoá khỏi db, ghi vào x_word.txt
    unmarkUsed(word);
    rejectWord(word);
  } else if (game.lastWord !== prevWord) {
    // Đối thủ đã nối trước (gửi cùng lúc): bị ❌ vì lệch lượt, từ vẫn chưa dùng
    unmarkUsed(word);
    log(`   ❌ ${word} (đối thủ nối trước)`);
  } else {
    // Lỗi khác (vd từ đã dùng): giữ trong db nhưng không gửi lại trong ván này
    log(`   ❌ ${word}`);
  }

  if (game.lastWord !== prevWord) return false;

  if (++game.retries > config.maxRetries) {
    log(`   (sai ${config.maxRetries} lần liền, bỏ lượt)`);
    return false;
  }
  game.ourTurn = true;
  return true;
}

/* ---------------- Đồng bộ khi khởi động ---------------- */

async function syncHistory(channel) {
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!fetched) return;
  const messages = [...fetched.values()].sort((a, b) => (isNewer(a.id, b.id) ? 1 : -1));

  // Chỉ quan tâm từ lần bắt đầu ván gần nhất trở đi
  let from = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isReferee(messages[i].author) && parseStartWord(messages[i])) {
      from = i;
      break;
    }
  }

  for (const message of messages.slice(from)) {
    if (isReferee(message.author)) {
      const start = parseStartWord(message);
      if (start) startRound(start, message);
      continue;
    }

    const word = asWord(message.content);
    if (!word || !game.lastWord) continue;
    const mine = message.author.id === client.user.id;
    if (!mine && !isOpponent(message.author)) continue;

    if (hasReaction(message, ...OK_EMOJIS)) {
      if (!mine) learnWord(word);
      markUsed(word);
      game.lastWord = word;
      game.lastMsgId = message.id;
      game.ourTurn = !mine;
      game.pending = null;
    } else if (mine && !hasReaction(message, BAD_EMOJI, UNKNOWN_EMOJI)) {
      // Từ của mình chưa được chấm: coi như đang chờ
      markUsed(word);
      game.ourTurn = false;
      game.pending = { msgId: message.id, word, prevWord: game.lastWord };
    }
  }

  if (game.lastWord) log(`── Tiếp tục ván, từ cuối: ${game.lastWord}`);
}

/* ---------------- Sự kiện ---------------- */

client.on('ready', async () => {
  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isText()) {
    console.error(`Không truy cập được channel ${config.channelId}`);
    process.exit(1);
  }
  log(`${client.user.tag} @ #${channel.name} — ${dictionary.size} từ, ${rejected.size} từ bị loại`);

  resetGame();
  await syncHistory(channel);
  await play();
});

client.on('messageCreate', async message => {
  if (message.channelId !== config.channelId || !isReferee(message.author)) return;

  const invalid = parseNotInDictWord(message);
  if (invalid && dictionary.has(invalid)) rejectWord(invalid);

  const start = parseStartWord(message);
  if (!start) return;
  log(`\n── Ván mới: ${start}`);
  startRound(start, message);
  await play();
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.message.channelId !== config.channelId || !isReferee(user)) return;
  const emoji = reaction.emoji.name?.replace('\uFE0F', '');
  const ok = OK_EMOJIS.has(emoji);
  if (!ok && emoji !== BAD_EMOJI && emoji !== UNKNOWN_EMOJI) return;

  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message) return;
  const word = asWord(message.content);
  if (!word) return;

  if (message.author.id === client.user.id) {
    // Reaction có thể tới trước khi channel.send() trả về id tin nhắn
    for (let i = 0; i < 10 && game.busy && game.pending?.msgId !== message.id; i++) await sleep(200);
    if (game.pending?.msgId !== message.id) return;
    if (ok) {
      game.lastWord = word;
      game.lastMsgId = message.id;
      game.pending = null;
      game.retries = 0;
    } else if (rejectOurWord(emoji)) {
      await play();
    }
    return;
  }

  if (ok && isOpponent(message.author)) {
    learnWord(word);
    if (acceptOpponentWord(word, message)) await play();
  }
});

process.on('unhandledRejection', err => console.error('unhandledRejection:', err));

client.login(config.token);
