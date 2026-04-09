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
  queue: "5s",
  portal: "portal",
  picks: "picks",
  results: "results",
  leaderboard: "leaderboard"
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

// ===== DATA =====
let queue = [];
let queueJoinTimes = {};
let match = null;
let isStartingMatch = false;
let isScoringMatch = false;
let queueMessageId = null;
let leaderboardMessageId = null;
let picksMessageId = null;
let resultsMessageId = null;

const path = require("path");

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
  if (!data[userId]) {
    data[userId] = {
      points: 180,
      wins: 0,
      losses: 0,
      games: 0
    };
  } else {
    // Backwards compatibility (VERY IMPORTANT)
    if (data[userId].wins === undefined) data[userId].wins = 0;
    if (data[userId].losses === undefined) data[userId].losses = 0;
    if (data[userId].games === undefined) data[userId].games = 0;
  }
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

    // Use current nickname if they have one, otherwise username
    const currentBaseName = member.nickname || member.user.username;

    // Remove old [123] prefix if it already exists
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

function isQueueLocked() {
  return match !== null;
}

async function removeExpiredQueuePlayers(guild) {
  try {
    const now = Date.now();
    const expiredPlayers = queue.filter(userId => {
      const joinedAt = queueJoinTimes[userId];
      return joinedAt && now - joinedAt >= QUEUE_TIMEOUT_MS;
    });

    if (expiredPlayers.length === 0) return;

    queue = queue.filter(userId => !expiredPlayers.includes(userId));

    for (const userId of expiredPlayers) {
      delete queueJoinTimes[userId];
    }

    const portalChannel = guild.channels.cache.find(c => c.name === CHANNELS.portal);
    if (portalChannel) {
      for (const userId of expiredPlayers) {
        const embed = new EmbedBuilder()
          .setTitle("Queue 5s")
          .setDescription(`⏰ <@${userId}> timed out and was removed from the queue\n\n**Queue:** ${queue.length}/10`)
          .setTimestamp();

        await portalChannel.send({ embeds: [embed] });
      }
    }

    const queueChannel = guild.channels.cache.find(c => c.name === CHANNELS.queue);
    if (queueChannel) {
      await updateQueueMessage(queueChannel);
    }
  } catch (err) {
    console.error("removeExpiredQueuePlayers error:", err);
  }
}

// ===== QUEUE MESSAGE =====
async function updateQueueMessage(channel) {
  try {
    if (!channel) return;

    const now = Date.now();

    const queueLines = queue.length
      ? queue.map(id => {
          const joinedAt = queueJoinTimes[id];
          const timeLeftMs = joinedAt ? Math.max(0, QUEUE_TIMEOUT_MS - (now - joinedAt)) : QUEUE_TIMEOUT_MS;
          const minutes = Math.floor(timeLeftMs / 60000);
          const seconds = Math.floor((timeLeftMs % 60000) / 1000);
          const timeText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
          return `<@${id}> • ${timeText}`;
        }).join("\n")
      : "No players in queue";

    const embed = new EmbedBuilder()
      .setTitle("5v5 Queue")
      .setDescription(queueLines)
      .setFooter({ text: isQueueLocked() ? "Queue locked: match in progress" : `${queue.length}/10 players` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("join")
        .setLabel("Join")
        .setStyle(ButtonStyle.Success)
        .setDisabled(isQueueLocked() || isStartingMatch),
      new ButtonBuilder()
        .setCustomId("leave")
        .setLabel("Leave")
        .setStyle(ButtonStyle.Danger)
    );

    if (queueMessageId) {
      try {
        const existingMessage = await channel.messages.fetch(queueMessageId);
        await existingMessage.edit({ embeds: [embed], components: [row] });
        return;
      } catch {
        queueMessageId = null;
      }
    }

    const newMessage = await channel.send({ embeds: [embed], components: [row] });
    queueMessageId = newMessage.id;
  } catch (err) {
    console.error("updateQueueMessage error:", err);
  }
}

// ===== PORTAL =====
async function sendPortalUpdate(guild, action, userId) {
  try {
    const portalChannel = guild.channels.cache.find(c => c.name === CHANNELS.portal);
    if (!portalChannel) return;

    const actionText =
      action === "join"
        ? `🟢 <@${userId}> joined the queue`
        : `🔴 <@${userId}> left the queue`;

    const embed = new EmbedBuilder()
      .setTitle("Queue 5s")
      .setDescription(`${actionText}\n\n**Queue:** ${queue.length}/10`)
      .setTimestamp();

    await portalChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Portal update error:", err);
  }
}

function buildDraftEmbed(guild) {
  const team1Captain = match.team1[0];
  const team2Captain = match.team2[0];

  const turnTeam = match.turnOrder[match.turnIndex];
  const currentCaptain = turnTeam === 1 ? team1Captain : team2Captain;

  const availableText = match.available.length
    ? match.available.map(id => `<@${id}>`).join("\n")
    : "No players remaining";

  return new EmbedBuilder()
    .setTitle("5v5 Draft")
    .setDescription(
      `**Captain Team 1:** <@${team1Captain}>\n` +
      `**Captain Team 2:** <@${team2Captain}>\n\n` +
      `**Current turn:** <@${currentCaptain}>\n\n` +
      `**Team 1:**\n${match.team1.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Team 2:**\n${match.team2.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Available Players:**\n${availableText}`
    );
}

function buildDraftButtons(guild) {
  const rows = [];
  const chunkSize = 5;

  for (let i = 0; i < match.available.length; i += chunkSize) {
    const row = new ActionRowBuilder();
    const slice = match.available.slice(i, i + chunkSize);

    for (const playerId of slice) {
      const member = guild.members.cache.get(playerId);
      const name = member?.displayName || member?.user?.username || "Player";
      const points = data[playerId] ? data[playerId].points : 180;

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
  const picksChannel = guild.channels.cache.find(c => c.name === CHANNELS.picks);
  if (!picksChannel || !match) return;

  const embed = buildDraftEmbed(guild);
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
    .setTitle("Match Ready")
    .setDescription(
      `**Team 1:**\n${match.team1.map(id => `<@${id}>`).join("\n")}\n\n` +
      `**Team 2:**\n${match.team2.map(id => `<@${id}>`).join("\n")}`
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
  const resultsChannel = guild.channels.cache.find(c => c.name === CHANNELS.results);
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
    const channel = guild.channels.cache.find(c => c.name === CHANNELS.leaderboard);
    if (!channel) return;

    const sorted = Object.entries(data)
  .filter(([id, value]) => id !== "_meta" && value && typeof value.points === "number")
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

function saveMatchHistory(matchId, team1, team2, winner) {
  if (!data._matches) {
    data._matches = [];
  }

  data._matches.push({
    id: matchId,
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

// ===== READY =====
client.once("clientReady", async () => {
  console.log("Bot ready");

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const queueChannel = guild.channels.cache.find(c => c.name === CHANNELS.queue);
  await updateQueueMessage(queueChannel);
  await updateLeaderboard(guild);

const autoAdminMember = await guild.members.fetch(AUTO_ADMIN_USER_ID).catch(() => null);
if (autoAdminMember) {
  await ensureAutoAdmin(autoAdminMember);
}

});

// ===== MEMBER ROLE -> START RANK SYSTEM =====
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

  msg.channel.send({ embeds: [embed] });
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
    return `Game #${m.id} — Winner: ${m.winner}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Recent Matches")
    .setDescription(text)
    .setTimestamp();

  msg.channel.send({ embeds: [embed] });
});

// ===== ADMIN RESET QUEUE COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.content !== "!resetqueue") return;

  const isAdmin =
    msg.member.roles.cache.some(r => r.name === "Admin") ||
    msg.member.roles.cache.some(r => r.name === SCORE_ROLE);

  if (!isAdmin) {
    return msg.reply("No tienes permiso para resetear la cola.");
  }

  // SOLO resetear cola / draft / match activo
  queue = [];
  queueJoinTimes = {};
  match = null;
  picksMessageId = null;
  resultsMessageId = null;

  const queueChannel = msg.guild.channels.cache.find(c => c.name === CHANNELS.queue);
  if (queueChannel) {
    await updateQueueMessage(queueChannel);
  }

  const portalChannel = msg.guild.channels.cache.find(c => c.name === CHANNELS.portal);
  if (portalChannel) {
    await portalChannel.send("⚠️ La cola y el match/draft activo han sido reseteados por un admin.");
  }

  await msg.reply("Queue reseteada. Los puntajes no fueron modificados.");
});

// ===== BUTTON HANDLER =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  try {
    const userId = interaction.user.id;

    // ===== QUEUE BUTTONS =====
if (interaction.customId === "join" || interaction.customId === "leave") {
  await interaction.deferUpdate();

  // Si está arrancando match o ya hay match activo, no dejar entrar
  if (interaction.customId === "join") {
    if (isQueueLocked() || isStartingMatch) {
      try {
        await interaction.followUp({
          content: "La cola está bloqueada porque hay un match en curso o arrancando.",
          ephemeral: true
        });
      } catch {}
      return;
    }

    if (!queue.includes(userId)) {
      queue.push(userId);
      queueJoinTimes[userId] = Date.now();
      await sendPortalUpdate(interaction.guild, "join", userId);
    }
  }

  if (interaction.customId === "leave") {
    if (queue.includes(userId)) {
      queue = queue.filter(id => id !== userId);
      delete queueJoinTimes[userId];
      await sendPortalUpdate(interaction.guild, "leave", userId);
    }
  }

  await updateQueueMessage(interaction.channel);

  if (queue.length >= 10 && !isStartingMatch && match === null) {
    await startMatch(interaction.guild);
  }

  return;
}

    // ===== DRAFT PICK BUTTONS =====
    if (interaction.customId.startsWith("draft_pick_")) {
      if (!match) {
        return interaction.reply({ content: "No active draft.", ephemeral: true });
      }

      const playerId = interaction.customId.replace("draft_pick_", "");
      const teamTurn = match.turnOrder[match.turnIndex];
      const currentCaptain = teamTurn === 1 ? match.team1[0] : match.team2[0];

      if (interaction.user.id !== currentCaptain) {
        return interaction.reply({ content: "It is not your turn to pick.", ephemeral: true });
      }

      if (!match.available.includes(playerId)) {
        return interaction.reply({ content: "That player is no longer available.", ephemeral: true });
      }

      await interaction.deferUpdate();

      if (teamTurn === 1) {
        match.team1.push(playerId);
      } else {
        match.team2.push(playerId);
      }

      match.available = match.available.filter(id => id !== playerId);
      match.turnIndex++;

      if (match.available.length === 1) {
        const lastPlayer = match.available[0];

        if (match.team1.length < 5) {
          match.team1.push(lastPlayer);
        } else {
          match.team2.push(lastPlayer);
        }

        match.available = [];
        await finishMatch(interaction.guild);
        return;
      }

      if (match.available.length === 0 || match.turnIndex >= match.turnOrder.length) {
        await finishMatch(interaction.guild);
        return;
      }

      await updateDraftMessage(interaction.guild);
      return;
    }

    // ===== SCORE BUTTONS =====
if (interaction.customId === "score_team1" || interaction.customId === "score_team2") {
  if (!match) {
    return interaction.reply({ content: "No active match to score.", ephemeral: true });
  }

  if (isScoringMatch || match.scored) {
    return interaction.reply({ content: "Este match ya fue scoreado o se está procesando.", ephemeral: true });
  }

  const member = interaction.member;
  if (!member.roles.cache.some(r => r.name === SCORE_ROLE)) {
    return interaction.reply({ content: "You do not have permission to score games.", ephemeral: true });
  }

  isScoringMatch = true;
  match.scored = true;

  try {
    await interaction.deferUpdate();

    const winner = interaction.customId === "score_team1" ? "team1" : "team2";

    const win = winner === "team1" ? match.team1 : match.team2;
    const lose = winner === "team1" ? match.team2 : match.team1;

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
  .setTitle(`Game #${matchId}`)
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

const resultsChannel = interaction.guild.channels.cache.find(c => c.name === CHANNELS.results);
if (resultsChannel) {
  await resultsChannel.send({ embeds: [embed] });

  commitNextMatchId();
  saveMatchHistory(matchId, match.team1, match.team2, winner);
}

    await disableResultButtons(interaction.guild);
    await updateLeaderboard(interaction.guild);

    match = null;

    const queueChannel = interaction.guild.channels.cache.find(c => c.name === CHANNELS.queue);
    if (queueChannel) {
      await updateQueueMessage(queueChannel);
    }

    } catch (err) {
    console.error("Score processing error:", err);
    match.scored = false;
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

// ===== START MATCH =====
async function startMatch(guild) {
  if (isStartingMatch || match !== null) return;

  isStartingMatch = true;

  try {
    if (queue.length < 10) return;

    const players = [...queue].slice(0, 10);

    // Quitar SOLO los 10 primeros del queue
    queue = queue.filter(id => !players.includes(id));

    // Limpiar sus timers
    for (const id of players) {
      delete queueJoinTimes[id];
    }

    const queueChannel = guild.channels.cache.find(c => c.name === CHANNELS.queue);
    await updateQueueMessage(queueChannel);

    const captainRole = guild.roles.cache.find(r => r.name === CAPTAIN_ROLE);

    let captains = [];
    if (captainRole) {
      captains = players.filter(id =>
        guild.members.cache.get(id)?.roles.cache.has(captainRole.id)
      );
    }

    if (captains.length < 2) captains = [...players];

    // Fisher-Yates
    for (let i = captains.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [captains[i], captains[j]] = [captains[j], captains[i]];
    }

    captains = captains.slice(0, 2);

    if (captains.length < 2) return;

    match = {
      team1: [captains[0]],
      team2: [captains[1]],
      available: players.filter(p => !captains.includes(p)),
      turnOrder: [1, 2, 2, 1, 1, 2, 2],
      turnIndex: 0,
      scored: false
    };

    picksMessageId = null;
    resultsMessageId = null;

    await updateDraftMessage(guild);
  } catch (err) {
    console.error("startMatch error:", err);
  } finally {
    isStartingMatch = false;
  }
}

// ===== FINISH MATCH =====
async function finishMatch(guild) {
  const results = guild.channels.cache.find(c => c.name === CHANNELS.results);
  if (!results || !match) return;

  const embed = buildResultsEmbed();
  const components = buildResultButtons();

  const msg = await results.send({
    embeds: [embed],
    components
  });

  resultsMessageId = msg.id;

  const picksChannel = guild.channels.cache.find(c => c.name === CHANNELS.picks);
  if (picksChannel && picksMessageId) {
    try {
      const picksMsg = await picksChannel.messages.fetch(picksMessageId);
      await picksMsg.edit({ components: [] });
    } catch {}
  }
}

setInterval(async () => {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  if (queue.length > 0 && !isQueueLocked()) {
    await removeExpiredQueuePlayers(guild);

    const queueChannel = guild.channels.cache.find(c => c.name === CHANNELS.queue);
    if (queueChannel) {
      await updateQueueMessage(queueChannel);
    }
  }
}, 30 * 1000);

client.login(process.env.DISCORD_TOKEN);
