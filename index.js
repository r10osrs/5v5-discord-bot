require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const AUTO_ADMIN_USER_ID = "1487098040354603131";
const AUTO_ADMIN_ROLE = "Admin";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// ===== CONFIG =====
const CHANNELS = {
  portal: "portal",
  picks: "picks",
  results: "results",
  leaderboard: "leaderboard",
  battle: "battle-royale"
};

const MODES = {
  "3s": {
    label: "3v3",
    queueChannel: "3s",
    size: 6,
    turnOrder: [1, 2, 2, 1]
  },
  "5s": {
    label: "5v5",
    queueChannel: "5s",
    size: 10,
    turnOrder: [1, 2, 2, 1, 1, 2, 2]
  },
  "7s": {
    label: "7v7",
    queueChannel: "7s",
    size: 14,
    turnOrder: [1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1]
  },
  "5s-rsb": {
    label: "5v5 RSB",
    queueChannel: "5s-rsb",
    size: 10,
    turnOrder: [1, 2, 2, 1, 1, 2, 2]
  }
};

const CAPTAIN_ROLE = "Captain";
const SCORE_ROLE = "Game Score";
const MEMBER_ROLE = "Member";
const ADMIN_ROLE = "Admin";

const RANK_ROLE_NAMES = [
  "Wooden",
  "Bronze",
  "Iron",
  "Steel",
  "Mithril",
  "Adamant",
  "Rune",
  "Granite",
  "Dragon",
  "Barrows",
  "Abyssal",
  "Oblivion",
  "Master",
  "Wise Old Man"
];

const QUEUE_TIMEOUT_MINUTES = 60;
const QUEUE_TIMEOUT_MS = QUEUE_TIMEOUT_MINUTES * 60 * 1000;

// ===== DATA FILE =====
const DATA_FILE = process.env.DATA_FILE_PATH || path.join(__dirname, "data.json");

let data = {};
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
  data = {};
}

function saveData() {
  const dir = path.dirname(DATA_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ===== GLOBAL STATE =====
const queueState = {
  "3s": { queue: [], queueJoinTimes: {}, messageId: null },
  "5s": { queue: [], queueJoinTimes: {}, messageId: null },
  "7s": { queue: [], queueJoinTimes: {}, messageId: null },
  "5s-rsb": { queue: [], queueJoinTimes: {}, messageId: null }
};

const battleState = {
  unlocked: false,
  queue: [],
  queueJoinTimes: {},
  messageId: null
};

let battleMatch = null;
let battleDraftMessageId = null;
let activeMatch = null;
let isStartingMatch = false;
let isScoringMatch = false;
let leaderboardMessageId = null;
let picksMessageId = null;
let resultsMessageId = null;

// ===== HELPERS =====
function isAnyMatchRunning() {
  return activeMatch !== null;
}

function getPlayerQueuedMode(userId) {
  for (const modeKey of Object.keys(queueState)) {
    if (queueState[modeKey].queue.includes(userId)) {
      return modeKey;
    }
  }
  return null;
}

function getQueueChannel(guild, modeKey) {
  return guild.channels.cache.find(c => c.name === MODES[modeKey].queueChannel);
}

function getPicksChannel(guild) {
  return guild.channels.cache.find(c => c.name === CHANNELS.picks);
}

function getResultsChannel(guild) {
  return guild.channels.cache.find(c => c.name === CHANNELS.results);
}

function getPortalChannel(guild) {
  return guild.channels.cache.find(c => c.name === CHANNELS.portal);
}

function getLeaderboardChannel(guild) {
  return guild.channels.cache.find(c => c.name === CHANNELS.leaderboard);
}

function getBattleChannel(guild) {
  return guild.channels.cache.find(c => c.name === CHANNELS.battle);
}

async function updateAllQueueMessages(guild) {
  for (const modeKey of Object.keys(MODES)) {
    const channel = getQueueChannel(guild, modeKey);
    if (channel) {
      await updateQueueMessage(modeKey, channel);
    }
  }
}

// ===== RANK SYSTEM =====
function getRank(points) {
  if (points < 100) return { name: "Wooden", win: 30, lose: -10 };
  if (points < 200) return { name: "Bronze", win: 29, lose: -11 };
  if (points < 300) return { name: "Iron", win: 28, lose: -12 };
  if (points < 400) return { name: "Steel", win: 27, lose: -13 };
  if (points < 500) return { name: "Mithril", win: 26, lose: -14 };
  if (points < 600) return { name: "Adamant", win: 25, lose: -15 };
  if (points < 700) return { name: "Rune", win: 24, lose: -16 };
  if (points < 800) return { name: "Granite", win: 23, lose: -17 };
  if (points < 900) return { name: "Dragon", win: 22, lose: -18 };
  if (points < 1000) return { name: "Barrows", win: 21, lose: -19 };
  if (points < 1100) return { name: "Abyssal", win: 20, lose: -20 };
  if (points < 1200) return { name: "Oblivion", win: 19, lose: -21 };
  if (points < 1300) return { name: "Master", win: 18, lose: -22 };
  return { name: "Wise Old Man", win: 17, lose: -23 };
}

function ensurePlayerData(userId) {
  let changed = false;

  if (!data[userId]) {
    data[userId] = {
      points: 180,
      wins: 0,
      losses: 0,
      games: 0
    };
    changed = true;
  } else {
    if (data[userId].wins === undefined) {
      data[userId].wins = 0;
      changed = true;
    }
    if (data[userId].losses === undefined) {
      data[userId].losses = 0;
      changed = true;
    }
    if (data[userId].games === undefined) {
      data[userId].games = 0;
      changed = true;
    }
  }

  if (changed) saveData();
}

async function updateMemberRankRole(member) {
  if (!member) return;

  ensurePlayerData(member.id);

  const rank = getRank(data[member.id].points);
  const targetRole = member.guild.roles.cache.find(role => role.name === rank.name);

  if (!targetRole) {
    console.error(`Rank role "${rank.name}" not found in server`);
    return;
  }

  const currentRankRoles = member.roles.cache.filter(role =>
    RANK_ROLE_NAMES.includes(role.name)
  );

  const hasCorrectRole = currentRankRoles.has(targetRole.id);
  const wrongRankRoles = currentRankRoles.filter(role => role.id !== targetRole.id);

  if (hasCorrectRole && wrongRankRoles.size === 0) {
    return;
  }

  if (wrongRankRoles.size > 0) {
    await member.roles.remove(wrongRankRoles).catch(err => {
      console.error(`Failed removing wrong rank roles for ${member.user.tag}:`, err.message);
    });
  }

  if (!member.roles.cache.has(targetRole.id)) {
    await member.roles.add(targetRole).catch(err => {
      console.error(`Failed adding rank role "${rank.name}" to ${member.user.tag}:`, err.message);
    });
  }
}

async function ensureAutoAdmin(member) {
  try {
    if (!member || member.id !== AUTO_ADMIN_USER_ID) return;

    const role = member.guild.roles.cache.find(r => r.name === AUTO_ADMIN_ROLE);
    if (!role) return;

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      console.log(`Auto-assigned ${AUTO_ADMIN_ROLE} to ${member.user.tag}`);
    }
  } catch (err) {
    console.error("ensureAutoAdmin error:", err);
  }
}

async function updateMemberPointsNickname(member) {
  try {
    if (!member) return;

    ensurePlayerData(member.id);

    const points = data[member.id].points;
    const currentBaseName = member.displayName;
    const cleanedBaseName = currentBaseName.replace(/^\[\d+\]\s*/, "");
    const newNick = `[${points}] ${cleanedBaseName}`.slice(0, 32);

    await member.setNickname(newNick).catch(err => {
      console.error(`Could not update nickname for ${member.user.tag}:`, err.message);
    });
  } catch (err) {
    console.error("Nickname update error:", err);
  }
}

async function initializeMember(member) {
  try {
    ensurePlayerData(member.id);
    await updateMemberRankRole(member);
    await updateMemberPointsNickname(member);
  } catch (err) {
    console.error("Initialize member error:", err);
  }
}

// ===== QUEUE TIMEOUT =====
async function removeExpiredQueuePlayers(guild, modeKey) {
  try {
    const state = queueState[modeKey];
    const now = Date.now();

    const expiredPlayers = state.queue.filter(userId => {
      const joinedAt = state.queueJoinTimes[userId];
      return joinedAt && now - joinedAt >= QUEUE_TIMEOUT_MS;
    });

    if (expiredPlayers.length === 0) return;

    state.queue = state.queue.filter(userId => !expiredPlayers.includes(userId));

    for (const userId of expiredPlayers) {
      delete state.queueJoinTimes[userId];
    }

    const portalChannel = getPortalChannel(guild);
    if (portalChannel) {
      for (const userId of expiredPlayers) {
        const embed = new EmbedBuilder()
          .setTitle(`${MODES[modeKey].label} Queue`)
          .setDescription(
            `⏰ <@${userId}> timed out and was removed from the queue\n\n` +
            `**Queue:** ${state.queue.length}/${MODES[modeKey].size}`
          )
          .setTimestamp();

        await portalChannel.send({ embeds: [embed] });
      }
    }

    const queueChannel = getQueueChannel(guild, modeKey);
    if (queueChannel) {
      await updateQueueMessage(modeKey, queueChannel);
    }
  } catch (err) {
    console.error(`removeExpiredQueuePlayers error (${modeKey}):`, err);
  }
}

// ===== QUEUE MESSAGE =====
async function updateQueueMessage(modeKey, channel) {
  try {
    if (!channel) return;

    const state = queueState[modeKey];
    const now = Date.now();

    const queueLines = state.queue.length
      ? state.queue.map(id => {
          const joinedAt = state.queueJoinTimes[id];
          const timeLeftMs = joinedAt
            ? Math.max(0, QUEUE_TIMEOUT_MS - (now - joinedAt))
            : QUEUE_TIMEOUT_MS;
          const minutes = Math.floor(timeLeftMs / 60000);
          const seconds = Math.floor((timeLeftMs % 60000) / 1000);
          const timeText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
          return `<@${id}> • ${timeText}`;
        }).join("\n")
      : "No players in queue";

    const embed = new EmbedBuilder()
      .setTitle(`${MODES[modeKey].label} Queue`)
      .setDescription(queueLines)
      .setFooter({
        text: isAnyMatchRunning()
          ? "Queues locked: match in progress"
          : `${state.queue.length}/${MODES[modeKey].size} players`
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`join_${modeKey}`)
        .setLabel("Join")
        .setStyle(ButtonStyle.Success)
        .setDisabled(isAnyMatchRunning() || isStartingMatch),
      new ButtonBuilder()
        .setCustomId(`leave_${modeKey}`)
        .setLabel("Leave")
        .setStyle(ButtonStyle.Danger)
    );

    if (state.messageId) {
      try {
        const existingMessage = await channel.messages.fetch(state.messageId);
        await existingMessage.edit({ embeds: [embed], components: [row] });
        return;
      } catch {
        state.messageId = null;
      }
    }

    const newMessage = await channel.send({ embeds: [embed], components: [row] });
    state.messageId = newMessage.id;
  } catch (err) {
    console.error(`updateQueueMessage error (${modeKey}):`, err);
  }
}

// ===== BATTLE ROYALE =====
async function updateBattleMessage(guild) {
  try {
    const channel = getBattleChannel(guild);
    if (!channel) return;

    const queueLines = battleState.queue.length
      ? battleState.queue.map((id, index) => `${index + 1}. <@${id}>`).join("\n")
      : "No players registered yet";

    const embed = new EmbedBuilder()
      .setTitle("🔥 Battle Royale Event")
      .setDescription(
        `**Status:** ${battleState.unlocked ? "🟢 OPEN" : "🔴 CLOSED"}\n` +
        `**Players:** ${battleState.queue.length}/40\n\n` +
        `${queueLines}`
      )
      .setFooter({
        text: battleState.unlocked
          ? "Registrations are open"
          : "Registrations are currently locked"
      })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("battle_join")
        .setLabel("Join Battle Royale")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!battleState.unlocked),
      new ButtonBuilder()
        .setCustomId("battle_leave")
        .setLabel("Leave Battle Royale")
        .setStyle(ButtonStyle.Danger)
    );

    if (battleState.messageId) {
      try {
        const msg = await channel.messages.fetch(battleState.messageId);
        await msg.edit({ embeds: [embed], components: [row] });
        return;
      } catch {
        battleState.messageId = null;
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    battleState.messageId = newMsg.id;
  } catch (err) {
    console.error("updateBattleMessage error:", err);
  }
}

// ===== PORTAL =====
async function sendPortalUpdate(guild, modeKey, action, userId) {
  try {
    const portalChannel = getPortalChannel(guild);
    if (!portalChannel) return;

    const state = queueState[modeKey];

    const actionText =
      action === "join"
        ? `🟢 <@${userId}> joined the ${MODES[modeKey].label} queue`
        : `🔴 <@${userId}> left the ${MODES[modeKey].label} queue`;

    const embed = new EmbedBuilder()
      .setTitle(`${MODES[modeKey].label} Queue`)
      .setDescription(`${actionText}\n\n**Queue:** ${state.queue.length}/${MODES[modeKey].size}`)
      .setTimestamp();

    await portalChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Portal update error:", err);
  }
}

// ===== DRAFT =====
function buildDraftEmbed() {
  if (!activeMatch) return null;

  const team1Captain = activeMatch.team1[0];
  const team2Captain = activeMatch.team2[0];

  const turnTeam = activeMatch.turnOrder[activeMatch.turnIndex];
  const currentCaptain = turnTeam === 1 ? team1Captain : team2Captain;

  const availableText = activeMatch.available.length
    ? activeMatch.available.map(id => `<@${id}>`).join("\n")
    : "No players remaining";

  return new EmbedBuilder()
    .setTitle(`${MODES[activeMatch.modeKey].label} Draft`)
    .setDescription(
      `**Captain Team 1:** <@${team1Captain}>\n` +
      `**Captain Team 2:** <@${team2Captain}>\n\n` +
      `**Current turn:** <@${currentCaptain}>\n\n` +
      `**Team 1:**\n${activeMatch.team1.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Team 2:**\n${activeMatch.team2.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Available Players:**\n${availableText}`
    );
}

function buildDraftButtons(guild) {
  if (!activeMatch) return [];

  const rows = [];
  const chunkSize = 5;

  for (let i = 0; i < activeMatch.available.length; i += chunkSize) {
    const row = new ActionRowBuilder();
    const slice = activeMatch.available.slice(i, i + chunkSize);

    for (const playerId of slice) {
      const member = guild.members.cache.get(playerId);
      const name = member?.displayName || member?.user?.username || "Player";
      ensurePlayerData(playerId);
      const points = data[playerId].points;
      const label = `${points} ${name}`.slice(0, 20);

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`draft_pick_${playerId}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary)
      );
    }

    rows.push(row);
  }

  return rows;
}

async function updateDraftMessage(guild) {
  const picksChannel = getPicksChannel(guild);
  if (!picksChannel || !activeMatch) return;

  const embed = buildDraftEmbed();
  const components = buildDraftButtons(guild);

  if (picksMessageId) {
    try {
      const msg = await picksChannel.messages.fetch(picksMessageId);
      await msg.edit({ embeds: [embed], components });
      return;
    } catch {
      picksMessageId = null;
    }
  }

  const newMsg = await picksChannel.send({ embeds: [embed], components });
  picksMessageId = newMsg.id;
}

function buildResultsEmbed() {
  return new EmbedBuilder()
    .setTitle(`${MODES[activeMatch.modeKey].label} Match Ready`)
    .setDescription(
      `**Team 1:**\n${activeMatch.team1.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Team 2:**\n${activeMatch.team2.map(id => `<@${id}>`).join("\n")}`
    );
}

function buildResultButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("score_team1")
        .setLabel("Team 1 Wins")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("score_team2")
        .setLabel("Team 2 Wins")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function disableResultButtons(guild) {
  const resultsChannel = getResultsChannel(guild);
  if (!resultsChannel || !resultsMessageId) return;

  try {
    const msg = await resultsChannel.messages.fetch(resultsMessageId);

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("score_team1_disabled")
        .setLabel("Team 1 Wins")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("score_team2_disabled")
        .setLabel("Team 2 Wins")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

    await msg.edit({ components: [disabledRow] });
  } catch (err) {
    console.error("disableResultButtons error:", err);
  }
}

// ===== LEADERBOARD =====
async function updateLeaderboard(guild) {
  try {
    const channel = getLeaderboardChannel(guild);
    if (!channel) return;

    const sorted = Object.entries(data)
      .filter(([id, value]) => id !== "_meta" && id !== "_matches" && value && typeof value.points === "number")
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 10);

    let text = "**🏆 Leaderboard**\n\n";

    for (let i = 0; i < sorted.length; i++) {
      const [id, playerData] = sorted[i];
      const rank = getRank(playerData.points);
      text += `${i + 1}. <@${id}> — ${playerData.points} pts (${rank.name})\n`;
    }

    if (leaderboardMessageId) {
      try {
        const msg = await channel.messages.fetch(leaderboardMessageId);
        await msg.edit(text);
        return;
      } catch {
        leaderboardMessageId = null;
      }
    }

    const newMsg = await channel.send(text);
    leaderboardMessageId = newMsg.id;
  } catch (err) {
    console.error("Leaderboard error:", err);
  }
}

// ===== POINTS =====
function updatePointsDetailed(id, win) {
  ensurePlayerData(id);

  const before = data[id].points;
  const rank = getRank(before);

  const change = win ? rank.win : rank.lose;
  const after = before + change;

  data[id].points = after;

  return { before, after };
}

function peekNextMatchId() {
  if (!data._meta) {
    data._meta = { nextMatchId: 1 };
  }

  return data._meta.nextMatchId;
}

function commitNextMatchId() {
  if (!data._meta) {
    data._meta = { nextMatchId: 1 };
  }

  const id = data._meta.nextMatchId;
  data._meta.nextMatchId += 1;
  saveData();

  return id;
}

function saveMatchHistory(matchId, modeKey, team1, team2, winner) {
  if (!data._matches) {
    data._matches = [];
  }

  data._matches.push({
    id: matchId,
    mode: modeKey,
    team1,
    team2,
    winner,
    timestamp: Date.now()
  });

  saveData();
}

async function refreshPlayerAfterPointChange(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  await updateMemberRankRole(member);
  await updateMemberPointsNickname(member);
}

// ===== BATTLE ROYALE MATCH =====
async function startBattleRoyale(guild) {
  if (battleMatch) return;

  const players = [...battleState.queue];

  if (players.length < 40) return;

  const captainRole = guild.roles.cache.find(r => r.name === CAPTAIN_ROLE);

  let captains = [];
  if (captainRole) {
    captains = players.filter(id =>
      guild.members.cache.get(id)?.roles.cache.has(captainRole.id)
    );
  }

  if (captains.length < 8) {
    const nonCaptains = players.filter(id => !captains.includes(id));
    captains = [...captains, ...nonCaptains];
  }

  for (let i = captains.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [captains[i], captains[j]] = [captains[j], captains[i]];
  }

  captains = captains.slice(0, 8);

  const teams = captains.map(captainId => [captainId]);
  const available = players.filter(id => !captains.includes(id));

  battleMatch = {
    teams,
    available,
    turnOrder: [0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0,0,1,2,3,4,5,6,7,7,6,5,4,3,2,1,0],
    turnIndex: 0,
    scored: false
  };

  battleState.unlocked = false;

  await updateBattleMessage(guild);
  await updateBattleDraftMessage(guild);
}

// ===== MATCH =====
async function startMatch(guild, modeKey) {
  if (isStartingMatch || activeMatch !== null) return;

  isStartingMatch = true;

  try {
    const state = queueState[modeKey];
    const config = MODES[modeKey];

    if (state.queue.length < config.size) return;

    const players = state.queue.slice(0, config.size);
    state.queue = state.queue.slice(config.size);

    for (const id of players) {
      delete state.queueJoinTimes[id];
    }

    await updateAllQueueMessages(guild);

    const captainRole = guild.roles.cache.find(r => r.name === CAPTAIN_ROLE);

    let captains = [];
    if (captainRole) {
      captains = players.filter(id =>
        guild.members.cache.get(id)?.roles.cache.has(captainRole.id)
      );
    }

    if (captains.length < 2) captains = [...players];

    for (let i = captains.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [captains[i], captains[j]] = [captains[j], captains[i]];
    }

    captains = captains.slice(0, 2);

    if (captains.length < 2) return;

    activeMatch = {
      modeKey,
      team1: [captains[0]],
      team2: [captains[1]],
      available: players.filter(p => !captains.includes(p)),
      turnOrder: config.turnOrder,
      turnIndex: 0,
      scored: false
    };

    picksMessageId = null;
    resultsMessageId = null;

    await updateDraftMessage(guild);
    await updateAllQueueMessages(guild);
  } catch (err) {
    console.error("startMatch error:", err);
  } finally {
    isStartingMatch = false;
  }
}

async function finishMatch(guild) {
  const results = getResultsChannel(guild);
  if (!results || !activeMatch) return;

  const embed = buildResultsEmbed();
  const components = buildResultButtons();

  const msg = await results.send({
    embeds: [embed],
    components
  });

  resultsMessageId = msg.id;

  const picksChannel = getPicksChannel(guild);
  if (picksChannel && picksMessageId) {
    try {
      const picksMsg = await picksChannel.messages.fetch(picksMessageId);
      await picksMsg.edit({ components: [] });
    } catch {}
  }
}

// ===== READY =====
client.once("clientReady", async () => {
  console.log("Bot ready");

  const guild = client.guilds.cache.first();
  if (!guild) return;

  for (const modeKey of Object.keys(MODES)) {
    const queueChannel = getQueueChannel(guild, modeKey);
    if (queueChannel) {
      await updateQueueMessage(modeKey, queueChannel);
    }
  }

  await updateLeaderboard(guild);

await updateBattleMessage(guild);

const autoAdminMember = await guild.members.fetch(AUTO_ADMIN_USER_ID).catch(() => null);
if (autoAdminMember) {
  await ensureAutoAdmin(autoAdminMember);
}

// ===== Battledraft =====
function buildBattleDraftEmbed() {
  if (!battleMatch) return null;

  const currentTeamIndex = battleMatch.turnOrder[battleMatch.turnIndex];
  const currentCaptain = battleMatch.teams[currentTeamIndex][0];

  let teamsText = "";

  for (let i = 0; i < battleMatch.teams.length; i++) {
    teamsText += `**Team ${i + 1}:**\n`;
    teamsText += battleMatch.teams[i].map(id => `<@${id}>`).join("\n");
    teamsText += "\n\n";
  }

  const availableText = battleMatch.available.length
    ? battleMatch.available.map(id => `<@${id}>`).join("\n")
    : "No players remaining";

  return new EmbedBuilder()
    .setTitle("🔥 Battle Royale Draft")
    .setDescription(
      `**Current turn:** <@${currentCaptain}> — Team ${currentTeamIndex + 1}\n\n` +
      `${teamsText}` +
      `**Available Players:**\n${availableText}`
    )
    .setTimestamp();
}

function buildBattleDraftButtons(guild) {
  if (!battleMatch) return [];

  const rows = [];
  const chunkSize = 5;

  for (let i = 0; i < battleMatch.available.length; i += chunkSize) {
    const row = new ActionRowBuilder();
    const slice = battleMatch.available.slice(i, i + chunkSize);

    for (const playerId of slice) {
      const member = guild.members.cache.get(playerId);
      const name = member?.displayName || member?.user?.username || "Player";
      ensurePlayerData(playerId);
      const points = data[playerId].points;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`battle_pick_${playerId}`)
          .setLabel(`${points} ${name}`.slice(0, 20))
          .setStyle(ButtonStyle.Primary)
      );
    }

    rows.push(row);
  }

  return rows;
}

async function updateBattleDraftMessage(guild) {
  const picksChannel = getPicksChannel(guild);
  if (!picksChannel || !battleMatch) return;

  const embed = buildBattleDraftEmbed();
  const components = buildBattleDraftButtons(guild);

  if (battleDraftMessageId) {
    try {
      const msg = await picksChannel.messages.fetch(battleDraftMessageId);
      await msg.edit({ embeds: [embed], components });
      return;
    } catch {
      battleDraftMessageId = null;
    }
  }

  const newMsg = await picksChannel.send({ embeds: [embed], components });
  battleDraftMessageId = newMsg.id;
}
});

// ===== MEMBER ROLE -> START RANK SYSTEM =====
client.on("guildMemberAdd", async member => {
  await ensureAutoAdmin(member);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const memberRole = newMember.guild.roles.cache.find(role => role.name === MEMBER_ROLE);
    if (!memberRole) return;

    const hadMemberRole = oldMember.roles.cache.has(memberRole.id);
    const hasMemberRole = newMember.roles.cache.has(memberRole.id);

    if (!hadMemberRole && hasMemberRole) {
      console.log(`Member role added to ${newMember.user.tag}`);
      await initializeMember(newMember);
    }
  } catch (err) {
    console.error("guildMemberUpdate error:", err);
  }
});

// ===== MANUAL COMMANDS HANDLER =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  const hasPermission =
    msg.member.roles.cache.some(r => r.name === ADMIN_ROLE) ||
    msg.member.roles.cache.some(r => r.name === SCORE_ROLE);

  if (!hasPermission) return;

  const args = msg.content.trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  if (!["!addpoints", "!removepoints", "!setpoints"].includes(command)) return;

  const target = msg.mentions.users.first();
  if (!target) {
    return msg.reply("Use a mention, for example: `!addpoints @user 25`");
  }

  const amount = Number(args[2]);
  if (!Number.isFinite(amount) || amount < 0) {
    return msg.reply("Use a valid positive number.");
  }

  ensurePlayerData(target.id);

  const before = data[target.id].points;

  if (command === "!addpoints") {
    data[target.id].points += amount;
  }

  if (command === "!removepoints") {
    data[target.id].points = Math.max(0, data[target.id].points - amount);
  }

  if (command === "!setpoints") {
    data[target.id].points = amount;
  }

  const after = data[target.id].points;
  saveData();

  await refreshPlayerAfterPointChange(msg.guild, target.id);
  await updateLeaderboard(msg.guild);

  const embed = new EmbedBuilder()
    .setTitle("Manual Points Update")
    .setDescription(
      `**User:** <@${target.id}>\n` +
      `**Command:** ${command}\n` +
      `**Points:** ${before} → ${after}\n` +
      `**By:** <@${msg.author.id}>`
    )
    .setTimestamp();

  await msg.channel.send({ embeds: [embed] });
});

// ===== PLAYER STATS COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!stats")) return;

  const target = msg.mentions.users.first() || msg.author;

  ensurePlayerData(target.id);

  const player = data[target.id];
  const winrate = player.games > 0
    ? ((player.wins / player.games) * 100).toFixed(1)
    : 0;

  const embed = new EmbedBuilder()
    .setTitle(`Stats for ${target.username}`)
    .addFields(
      { name: "Points", value: `${player.points}`, inline: true },
      { name: "Rank", value: getRank(player.points).name, inline: true },
      { name: "Games", value: `${player.games}`, inline: true },
      { name: "Wins", value: `${player.wins}`, inline: true },
      { name: "Losses", value: `${player.losses}`, inline: true },
      { name: "Winrate", value: `${winrate}%`, inline: true }
    )
    .setTimestamp();

  await msg.channel.send({ embeds: [embed] });
});

// ===== MATCH HISTORY COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!history")) return;

  if (!data._matches || data._matches.length === 0) {
    return msg.reply("No match history yet.");
  }

  const lastMatches = data._matches.slice(-5).reverse();

  const text = lastMatches.map(m => {
    return `Game #${m.id} — ${MODES[m.mode]?.label || m.mode} — Winner: ${m.winner}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Recent Matches")
    .setDescription(text)
    .setTimestamp();

  await msg.channel.send({ embeds: [embed] });
});

// ===== BATTLE ROYALE LOCK / UNLOCK COMMANDS =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  const command = msg.content.trim().toLowerCase();

  if (command !== "!unlockbattle" && command !== "!lockbattle") return;

  const hasPermission =
    msg.member.roles.cache.some(r => r.name === ADMIN_ROLE) ||
    msg.member.roles.cache.some(r => r.name === SCORE_ROLE);

  if (!hasPermission) {
    return msg.reply("You do not have permission to manage Battle Royale.");
  }

  if (command === "!unlockbattle") {
    battleState.unlocked = true;
    await updateBattleMessage(msg.guild);

    const portalChannel = getPortalChannel(msg.guild);
    if (portalChannel) {
      await portalChannel.send(`🔓 Battle Royale registrations opened by <@${msg.author.id}>.`);
    }

    return msg.reply("Battle Royale queue is now open.");
  }

  if (command === "!lockbattle") {
    battleState.unlocked = false;
    await updateBattleMessage(msg.guild);

    const portalChannel = getPortalChannel(msg.guild);
    if (portalChannel) {
      await portalChannel.send(`🔒 Battle Royale registrations closed by <@${msg.author.id}>.`);
    }

    return msg.reply("Battle Royale queue is now closed.");
  }
});

// ===== RESET SEASON COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.content.trim().toLowerCase() !== "!resetseason") return;

  const isAdmin = msg.member.roles.cache.some(r => r.name === ADMIN_ROLE);

  if (!isAdmin) {
    return msg.reply("You do not have permission to reset the season.");
  }

  for (const userId of Object.keys(data)) {
    if (userId.startsWith("_")) continue;

    if (data[userId] && typeof data[userId] === "object") {
      data[userId].points = 180;
      data[userId].wins = 0;
      data[userId].losses = 0;
      data[userId].games = 0;
    }
  }

  data._matches = [];
  if (data._meta) {
    data._meta.nextMatchId = 1;
  }

  saveData();

  const members = await msg.guild.members.fetch();

  for (const member of members.values()) {
    if (data[member.id]) {
      await updateMemberRankRole(member);
      await updateMemberPointsNickname(member);
    }
  }

  await updateLeaderboard(msg.guild);

  const portalChannel = getPortalChannel(msg.guild);
  if (portalChannel) {
    await portalChannel.send(
      "🏆 **New Season Started!**\nAll player scores have been reset to **180 points (Bronze)**."
    );
  }

  await msg.reply("Season reset complete. All players are back to 180 points.");
});

// ===== ADMIN RESET QUEUE COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.content !== "!resetqueue") return;

  const isAdmin =
    msg.member.roles.cache.some(r => r.name === ADMIN_ROLE) ||
    msg.member.roles.cache.some(r => r.name === SCORE_ROLE);

  if (!isAdmin) {
    return msg.reply("You do not have permission to reset the queue.");
  }

  for (const modeKey of Object.keys(queueState)) {
    queueState[modeKey].queue = [];
    queueState[modeKey].queueJoinTimes = {};
  }

  activeMatch = null;
  isStartingMatch = false;
  isScoringMatch = false;
  picksMessageId = null;
  resultsMessageId = null;

  battleState.unlocked = false;
  battleState.queue = [];
  battleState.queueJoinTimes = {};

  await updateAllQueueMessages(msg.guild);
  await updateBattleMessage(msg.guild);

  const portalChannel = getPortalChannel(msg.guild);
  if (portalChannel) {
    await portalChannel.send("⚠️ All queues and the active draft/match were reset by admin.");
  }

  await msg.reply("Queues reset complete. Scores were not changed.");
});

// ===== BUTTON HANDLER =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  try {
    const userId = interaction.user.id;

// ===== BATTLE ROYALE BUTTONS =====
if (interaction.customId === "battle_join" || interaction.customId === "battle_leave") {
  await interaction.deferUpdate();

  if (interaction.customId === "battle_join") {
    if (!battleState.unlocked) {
      try {
        await interaction.followUp({
          content: "Battle Royale registrations are currently locked.",
          ephemeral: true
        });
      } catch {}
      return;
    }

    if (battleState.queue.includes(userId)) {
      try {
        await interaction.followUp({
          content: "You are already registered for Battle Royale.",
          ephemeral: true
        });
      } catch {}
      return;
    }

    if (battleState.queue.length >= 40) {
      try {
        await interaction.followUp({
          content: "Battle Royale queue is already full.",
          ephemeral: true
        });
      } catch {}
      return;
    }

    battleState.queue.push(userId);
    battleState.queueJoinTimes[userId] = Date.now();

    const portalChannel = getPortalChannel(interaction.guild);
    if (portalChannel) {
      await portalChannel.send(
        `🔥 <@${userId}> joined Battle Royale — ${battleState.queue.length}/40`
      );
    }

    await updateBattleMessage(interaction.guild);

    if (battleState.queue.length === 40) {
  battleState.unlocked = false;

  const resultsChannel = getResultsChannel(interaction.guild);
  if (resultsChannel) {
    await resultsChannel.send(
      "🔥 **BATTLE ROYALE QUEUE FULL — 40/40**\nSelecting 8 captains and preparing the draft..."
    );
  }

  await startBattleRoyale(interaction.guild);
}

    return;
  }

  if (interaction.customId === "battle_leave") {
    if (battleState.queue.includes(userId)) {
      battleState.queue = battleState.queue.filter(id => id !== userId);
      delete battleState.queueJoinTimes[userId];

      const portalChannel = getPortalChannel(interaction.guild);
      if (portalChannel) {
        await portalChannel.send(
          `🔴 <@${userId}> left Battle Royale — ${battleState.queue.length}/40`
        );
      }

      await updateBattleMessage(interaction.guild);
    }

    return;
  }
}

// ===== BATTLE ROYALE SCORE BUTTONS =====
if (interaction.customId.startsWith("battle_score_team_")) {
  if (!battleMatch) {
    return interaction.reply({
      content: "No active Battle Royale match to score.",
      ephemeral: true
    });
  }

  if (isScoringMatch || battleMatch.scored) {
    return interaction.reply({
      content: "This Battle Royale has already been scored or is being processed.",
      ephemeral: true
    });
  }

  const member = interaction.member;
  if (!member.roles.cache.some(r => r.name === SCORE_ROLE)) {
    return interaction.reply({
      content: "You do not have permission to score Battle Royale.",
      ephemeral: true
    });
  }

  const winnerIndex = Number(interaction.customId.replace("battle_score_team_", ""));

  if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex > 7) {
    return interaction.reply({
      content: "Invalid Battle Royale winner.",
      ephemeral: true
    });
  }

  isScoringMatch = true;
  battleMatch.scored = true;

  try {
    await interaction.deferUpdate();

    const win = battleMatch.teams[winnerIndex];
    const lose = battleMatch.teams
      .filter((_, index) => index !== winnerIndex)
      .flat();

    const winData = {};
    const loseData = {};

    for (const id of win) {
      ensurePlayerData(id);
      winData[id] = updatePointsDetailed(id, true);
      data[id].wins += 1;
      data[id].games += 1;
    }

    for (const id of lose) {
      ensurePlayerData(id);
      loseData[id] = updatePointsDetailed(id, false);
      data[id].losses += 1;
      data[id].games += 1;
    }

    saveData();

    for (const playerId of [...win, ...lose]) {
      const guildMember = await interaction.guild.members.fetch(playerId).catch(() => null);
      if (guildMember) {
        await updateMemberRankRole(guildMember);
        await updateMemberPointsNickname(guildMember);
      }
    }

    const matchId = peekNextMatchId();

    const formatPlayers = (players, dataObj) =>
      players.map(id => {
        const p = dataObj[id];
        const stats = data[id];
        const winrate = stats.games > 0
          ? ((stats.wins / stats.games) * 100).toFixed(0)
          : 0;

        return `<@${id}> ${p.before} → ${p.after} | ${stats.wins}W-${stats.losses}L (${winrate}%)`;
      }).join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`Game #${matchId} — Battle Royale`)
      .addFields(
        {
          name: `🏆 Winners — Team ${winnerIndex + 1}`,
          value: formatPlayers(win, winData),
          inline: false
        },
        {
          name: "❌ Losers",
          value: formatPlayers(lose, loseData).slice(0, 1024),
          inline: false
        }
      )
      .setFooter({ text: `Winner: Team ${winnerIndex + 1}` })
      .setTimestamp();

    const resultsChannel = getResultsChannel(interaction.guild);
    if (!resultsChannel) {
      throw new Error("Results channel not found");
    }

    await resultsChannel.send({ embeds: [embed] });

    commitNextMatchId();

    if (!data._matches) {
      data._matches = [];
    }

    data._matches.push({
      id: matchId,
      mode: "Battle Royale",
      teams: battleMatch.teams,
      winner: `Team ${winnerIndex + 1}`,
      timestamp: Date.now()
    });

    saveData();

    await disableResultButtons(interaction.guild);
    await updateLeaderboard(interaction.guild);

    battleMatch = null;
    battleDraftMessageId = null;
    resultsMessageId = null;

    await updateAllQueueMessages(interaction.guild);
    await updateBattleMessage(interaction.guild);
  } catch (err) {
    console.error("Battle Royale score processing error:", err);
    if (battleMatch) battleMatch.scored = false;
  } finally {
    isScoringMatch = false;
  }

  return;
}

// ===== BATTLE ROYALE DRAFT PICKS =====
if (interaction.customId.startsWith("battle_pick_")) {
  if (!battleMatch) {
    return interaction.reply({ content: "No active Battle Royale draft.", ephemeral: true });
  }

  const playerId = interaction.customId.replace("battle_pick_", "");
  const teamIndex = battleMatch.turnOrder[battleMatch.turnIndex];
  const currentCaptain = battleMatch.teams[teamIndex][0];

  if (interaction.user.id !== currentCaptain) {
    return interaction.reply({ content: "It is not your turn to pick.", ephemeral: true });
  }

  if (!battleMatch.available.includes(playerId)) {
    return interaction.reply({ content: "That player is no longer available.", ephemeral: true });
  }

  await interaction.deferUpdate();

  battleMatch.teams[teamIndex].push(playerId);
  battleMatch.available = battleMatch.available.filter(id => id !== playerId);
  battleMatch.turnIndex++;

  const picksChannel = getPicksChannel(interaction.guild);
  if (picksChannel) {
    await picksChannel.send(`✅ Battle Royale Team ${teamIndex + 1} picked <@${playerId}>`);
  }

  if (battleMatch.available.length === 0 || battleMatch.turnIndex >= battleMatch.turnOrder.length) {
    await finishBattleRoyaleDraft(interaction.guild);
    return;
  }

  await updateBattleDraftMessage(interaction.guild);
  return;
}

    // ===== QUEUE BUTTONS =====
    if (interaction.customId.startsWith("join_") || interaction.customId.startsWith("leave_")) {
      await interaction.deferUpdate();

      const [action, modeKey] = interaction.customId.split("_");
      const state = queueState[modeKey];

      if (!state) return;

      if (action === "join") {
        if (isAnyMatchRunning() || isStartingMatch) {
          try {
            await interaction.followUp({
              content: "All queues are locked while a match is running or starting.",
              ephemeral: true
            });
          } catch {}
          return;
        }

        const existingQueue = getPlayerQueuedMode(userId);
        if (existingQueue && existingQueue !== modeKey) {
          try {
            await interaction.followUp({
              content: `You are already in the ${MODES[existingQueue].label} queue.`,
              ephemeral: true
            });
          } catch {}
          return;
        }

        if (!state.queue.includes(userId)) {
          state.queue.push(userId);
          state.queueJoinTimes[userId] = Date.now();
          await sendPortalUpdate(interaction.guild, modeKey, "join", userId);
        }
      }

      if (action === "leave") {
        if (state.queue.includes(userId)) {
          state.queue = state.queue.filter(id => id !== userId);
          delete state.queueJoinTimes[userId];
          await sendPortalUpdate(interaction.guild, modeKey, "leave", userId);
        }
      }

      await updateQueueMessage(modeKey, interaction.channel);

      if (state.queue.length >= MODES[modeKey].size && !isStartingMatch && activeMatch === null) {
        await startMatch(interaction.guild, modeKey);
      }

      return;
    }

    // ===== DRAFT PICK BUTTONS =====
    if (interaction.customId.startsWith("draft_pick_")) {
      if (!activeMatch) {
        return interaction.reply({ content: "No active draft.", ephemeral: true });
      }

      const playerId = interaction.customId.replace("draft_pick_", "");
      const teamTurn = activeMatch.turnOrder[activeMatch.turnIndex];
      const currentCaptain = teamTurn === 1 ? activeMatch.team1[0] : activeMatch.team2[0];

      if (interaction.user.id !== currentCaptain) {
        return interaction.reply({ content: "It is not your turn to pick.", ephemeral: true });
      }

      if (!activeMatch.available.includes(playerId)) {
        return interaction.reply({ content: "That player is no longer available.", ephemeral: true });
      }

      await interaction.deferUpdate();

      if (teamTurn === 1) {
        activeMatch.team1.push(playerId);
      } else {
        activeMatch.team2.push(playerId);
      }

      activeMatch.available = activeMatch.available.filter(id => id !== playerId);
      activeMatch.turnIndex++;

      const picksChannel = getPicksChannel(interaction.guild);

      if (activeMatch.available.length === 1) {
        const lastPlayer = activeMatch.available[0];

        let autoAssignedTeam = "";
        if (activeMatch.team1.length < activeMatch.team2.length) {
          activeMatch.team1.push(lastPlayer);
          autoAssignedTeam = "Team 1";
        } else {
          activeMatch.team2.push(lastPlayer);
          autoAssignedTeam = "Team 2";
        }

        activeMatch.available = [];

        await updateDraftMessage(interaction.guild);

        if (picksChannel) {
          await picksChannel.send(
            `✅ ${MODES[activeMatch.modeKey].label} Picked: <@${playerId}>\n` +
            `📌 Auto-assigned final player: <@${lastPlayer}> → ${autoAssignedTeam}`
          );
        }

        await finishMatch(interaction.guild);
        return;
      }

      if (activeMatch.available.length === 0 || activeMatch.turnIndex >= activeMatch.turnOrder.length) {
        await updateDraftMessage(interaction.guild);

        if (picksChannel) {
          await picksChannel.send(`✅ ${MODES[activeMatch.modeKey].label} Picked: <@${playerId}>`);
        }

        await finishMatch(interaction.guild);
        return;
      }

      await updateDraftMessage(interaction.guild);

      if (picksChannel) {
        await picksChannel.send(`✅ ${MODES[activeMatch.modeKey].label} Picked: <@${playerId}>`);
      }

      return;
    }

// ===== FINISH BATTLE ROYALE MATCH =====
async function finishBattleRoyaleDraft(guild) {
  const results = getResultsChannel(guild);
  if (!results || !battleMatch) return;

  const embed = new EmbedBuilder()
    .setTitle("🔥 Battle Royale Teams Ready")
    .setDescription(
      battleMatch.teams.map((team, index) => {
        return `**Team ${index + 1}:**\n${team.map(id => `<@${id}>`).join("\n")}`;
      }).join("\n\n")
    )
    .setTimestamp();

  const rows = [];
  for (let i = 0; i < 8; i += 4) {
    const row = new ActionRowBuilder();

    for (let j = i; j < i + 4; j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`battle_score_team_${j}`)
          .setLabel(`Team ${j + 1} Wins`)
          .setStyle(ButtonStyle.Success)
      );
    }

    rows.push(row);
  }

  const msg = await results.send({
    embeds: [embed],
    components: rows
  });

  resultsMessageId = msg.id;

  const picksChannel = getPicksChannel(guild);
  if (picksChannel && battleDraftMessageId) {
    try {
      const draftMsg = await picksChannel.messages.fetch(battleDraftMessageId);
      await draftMsg.edit({ components: [] });
    } catch {}
  }
}

    // ===== SCORE BUTTONS =====
    if (interaction.customId === "score_team1" || interaction.customId === "score_team2") {
      if (!activeMatch) {
        return interaction.reply({ content: "No active match to score.", ephemeral: true });
      }

      if (isScoringMatch || activeMatch.scored) {
        return interaction.reply({ content: "This match is already being scored or has already been scored.", ephemeral: true });
      }

      const member = interaction.member;
      if (!member.roles.cache.some(r => r.name === SCORE_ROLE)) {
        return interaction.reply({ content: "You do not have permission to score games.", ephemeral: true });
      }

      isScoringMatch = true;
      activeMatch.scored = true;

      try {
        await interaction.deferUpdate();

        const winner = interaction.customId === "score_team1" ? "team1" : "team2";

        const win = winner === "team1" ? activeMatch.team1 : activeMatch.team2;
        const lose = winner === "team1" ? activeMatch.team2 : activeMatch.team1;

        const winData = {};
        const loseData = {};

        for (const id of win) {
          ensurePlayerData(id);
          winData[id] = updatePointsDetailed(id, true);
          data[id].wins += 1;
          data[id].games += 1;
        }

        for (const id of lose) {
          ensurePlayerData(id);
          loseData[id] = updatePointsDetailed(id, false);
          data[id].losses += 1;
          data[id].games += 1;
        }

        saveData();

        for (const playerId of [...win, ...lose]) {
          const guildMember = await interaction.guild.members.fetch(playerId).catch(() => null);
          if (guildMember) {
            await updateMemberRankRole(guildMember);
            await updateMemberPointsNickname(guildMember);
          }
        }

        const matchId = peekNextMatchId();

        const formatPlayers = (players, dataObj) =>
          players.map(id => {
            const p = dataObj[id];
            const stats = data[id];
            const winrate = stats.games > 0
              ? ((stats.wins / stats.games) * 100).toFixed(0)
              : 0;

            return `<@${id}> ${p.before} → ${p.after} | ${stats.wins}W-${stats.losses}L (${winrate}%)`;
          }).join("\n");

        const embed = new EmbedBuilder()
          .setTitle(`Game #${matchId} — ${MODES[activeMatch.modeKey].label}`)
          .addFields(
            {
              name: "🏆 Winners",
              value: formatPlayers(win, winData),
              inline: true
            },
            {
              name: "❌ Losers",
              value: formatPlayers(lose, loseData),
              inline: true
            }
          )
          .setFooter({ text: `Winner: ${winner}` })
          .setTimestamp();

        const resultsChannel = getResultsChannel(interaction.guild);
        if (!resultsChannel) {
          throw new Error("Results channel not found");
        }

        await resultsChannel.send({ embeds: [embed] });

        commitNextMatchId();
        saveMatchHistory(matchId, activeMatch.modeKey, activeMatch.team1, activeMatch.team2, winner);

        await disableResultButtons(interaction.guild);
        await updateLeaderboard(interaction.guild);

        activeMatch = null;
        picksMessageId = null;
        resultsMessageId = null;

        await updateAllQueueMessages(interaction.guild);
      } catch (err) {
        console.error("Score processing error:", err);
        if (activeMatch) activeMatch.scored = false;
      } finally {
        isScoringMatch = false;
      }

      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true });
      } catch {}
    }
  }
});

// ===== QUEUE TIMEOUT LOOP =====
setInterval(async () => {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  for (const modeKey of Object.keys(MODES)) {
    if (queueState[modeKey].queue.length > 0 && !isAnyMatchRunning()) {
      await removeExpiredQueuePlayers(guild, modeKey);
    }
  }

  await updateAllQueueMessages(guild);
}, 30 * 1000);

client.login(process.env.DISCORD_TOKEN);
