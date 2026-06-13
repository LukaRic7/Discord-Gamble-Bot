const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

// Horses configuration: label and payout ratio
const HORSES = [
    { id: 1, label: '┌1┬►', ratio: 2.0 },
    { id: 2, label: '┌2┬►', ratio: 3.0 },
    { id: 3, label: '┌3┬►', ratio: 4.0 },
    { id: 4, label: '┌4┬►', ratio: 5.0 },
    { id: 5, label: '┌5┬►', ratio: 6.0 }
];

const BET_OPTIONS = [100, 250, 500, 1000, 2500];

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('race')
        .setDescription('Start a horse race that other users can join.')
        .addNumberOption((option) => option
            .setName('intermission_duration')
            .setDescription('Amount of seconds to wait before starting the race.')
            .setRequired(true)
            .setMinValue(10)
            .setMaxValue(120)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),

    // Callback for when the command is executed
    async execute(interaction) {
        const db = interaction.client.db;

        // Participants map: userId -> { userTag, horseId, ratio, bet }
        const participants = new Map();

        const intermission = interaction.options.getNumber('intermission_duration');

        try {
            // Build initial embed showing horses and empty participant lists
            const buildRaceDescription = () => {
                let desc = `Intermission: ${intermission} seconds — click Join to participate.`;
                desc += '\n\n';
                for (const h of HORSES) {
                    desc += `**${h.label} (${h.ratio}x)**\n`;
                    const list = Array.from(participants.values())
                        .filter(p => p.horseId === h.id)
                        .map(p => `${p.userTag} — ${formatBalance(p.bet)}`)
                        .join('\n');
                    desc += list ? `${list}\n\n` : '_No bets yet_\n\n';
                }
                return desc;
            };

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(buildRaceDescription())
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            const joinButton = new ButtonBuilder().setCustomId('race_join').setLabel('Join Race').setStyle(ButtonStyle.Primary);
            const leaveButton = new ButtonBuilder().setCustomId('race_leave').setLabel('Leave Race').setStyle(ButtonStyle.Secondary);
            const abortButton = new ButtonBuilder().setCustomId('race_abort').setLabel('Abort (host)').setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(joinButton, leaveButton, abortButton);

            await interaction.reply({ embeds: [embed], components: [row] });
            const mainMessage = await interaction.fetchReply();

            // Collector listens to join/leave/abort presses during intermission
            const collector = mainMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: intermission * 1000 });

            // Helper to edit main embed
            const refreshMainEmbed = async () => {
                embed.setDescription(buildRaceDescription());
                await interaction.editReply({ embeds: [embed] });
            };

            collector.on('collect', async (i) => {
                try {
                    // Only allow valid interactions
                    if (i.customId === 'race_join') {
                        // If user already in race
                        if (participants.has(i.user.id)) {
                            return i.reply({ content: 'You are already in the race.', flags: MessageFlags.Ephemeral });
                        }

                        // Show ephemeral selection UI: horse select, bet select, abort
                        const horseOptions = HORSES.map(h => ({ label: `${h.label} — ${h.ratio}x`, value: `${h.id}|${h.ratio}` }));

                        // Build bet options but mark unaffordable later — we will filter on confirm
                        const betOptions = BET_OPTIONS.map(b => ({ label: `${b}`, value: `${b}` }));

                        const horseSelect = new StringSelectMenuBuilder()
                            .setCustomId('race_select_horse')
                            .setPlaceholder('Choose your horse')
                            .setOptions(horseOptions);

                        const betSelect = new StringSelectMenuBuilder()
                            .setCustomId('race_select_bet')
                            .setPlaceholder('Choose your bet')
                            .setOptions(betOptions);

                        const abort = new ButtonBuilder().setCustomId('race_join_abort').setLabel('Abort').setStyle(ButtonStyle.Danger);

                        await i.reply({ content: 'Choose your horse and bet (this message is ephemeral).', components: [new ActionRowBuilder().addComponents(horseSelect), new ActionRowBuilder().addComponents(betSelect), new ActionRowBuilder().addComponents(abort)], ephemeral: true });
                        const joinMsg = await i.fetchReply();

                        let chosenHorse = null;
                        let chosenBet = null;

                        const joinCollector = joinMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60_000 });

                        joinCollector.on('collect', async (sel) => {
                            if (sel.user.id !== i.user.id) return sel.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            if (sel.customId === 'race_select_horse') {
                                const [id, ratio] = sel.values[0].split('|');
                                chosenHorse = { id: Number(id), ratio: Number(ratio) };
                                await sel.reply({ content: `Horse ${chosenHorse.id} selected (${chosenHorse.ratio}x). Now pick a bet.`, flags: MessageFlags.Ephemeral });
                            }

                            if (sel.customId === 'race_select_bet') {
                                chosenBet = Number(sel.values[0]);
                                // Check balance right before finalizing
                                const profile = await db.getUser(i.user.id);
                                if (!profile || profile.balance < chosenBet) {
                                    await sel.reply({ embeds: [await createInsufficientMoneyEmbed(i, chosenBet)], flags: MessageFlags.Ephemeral });
                                    return joinCollector.stop('insufficient');
                                }

                                // All selections done: add to participants
                                participants.set(i.user.id, { userTag: i.user.tag, horseId: chosenHorse.id, ratio: chosenHorse.ratio, bet: chosenBet });
                                await sel.reply({ content: `You joined the race: Horse ${chosenHorse.id} for ${formatBalance(chosenBet)}.`, flags: MessageFlags.Ephemeral });
                                await refreshMainEmbed();
                                joinCollector.stop('joined');
                            }
                        });

                        joinCollector.on('end', async (_, reason) => {
                            if (reason === 'insufficient') {
                                // nothing else to do
                            }
                        });

                    } else if (i.customId === 'race_leave') {
                        if (!participants.has(i.user.id)) {
                            return i.reply({ content: 'You are not in the race.', flags: MessageFlags.Ephemeral });
                        }

                        // Ask for confirmation
                        const confirm = new ButtonBuilder().setCustomId('race_leave_confirm').setLabel('Confirm Leave').setStyle(ButtonStyle.Danger);
                        const cancel = new ButtonBuilder().setCustomId('race_leave_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
                        await i.reply({ content: 'Are you sure you want to leave the race?', components: [new ActionRowBuilder().addComponents(confirm, cancel)], ephemeral: true });
                        const leaveMsg = await i.fetchReply();

                        const leaveCollector = leaveMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

                        leaveCollector.on('collect', async (btn) => {
                            if (btn.user.id !== i.user.id) return btn.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            if (btn.customId === 'race_leave_confirm') {
                                participants.delete(i.user.id);
                                await btn.reply({ content: 'You have left the race.', flags: MessageFlags.Ephemeral });
                                await refreshMainEmbed();
                                leaveCollector.stop('left');
                            } else {
                                await btn.reply({ content: 'Leave cancelled.', flags: MessageFlags.Ephemeral });
                                leaveCollector.stop('cancelled');
                            }
                        });

                    } else if (i.customId === 'race_abort') {
                        // Only the command user (host) can abort — check equality
                        if (i.user.id !== interaction.user.id) {
                            return i.reply({ content: 'Only the host can abort this race.', flags: MessageFlags.Ephemeral });
                        }

                        collector.stop('aborted');
                        await i.reply({ content: 'Race aborted by host.', flags: MessageFlags.Ephemeral });
                    }
                } catch (err) {
                    handleInteractionError(i, err);
                }
            });

            collector.on('end', async (_, reason) => {
                // Remove buttons from main message
                await interaction.editReply({ components: [] });

                if (reason === 'aborted') {
                    // Inform channel that race was aborted
                    embed.setDescription('Race was aborted by the host.');
                    embed.setColor(Colors.RED);
                    return await interaction.editReply({ embeds: [embed] });
                }

                // Start the race
                const trackLength = 40;
                const positions = HORSES.map(() => 0);

                let winnerIndex = -1;

                while (winnerIndex === -1) {
                    await wait(800);

                    // Advance each horse by a random amount 1..6
                    for (let idx = 0; idx < HORSES.length; idx++) {
                        positions[idx] += Math.floor(Math.random() * 6) + 1;
                        if (positions[idx] >= trackLength) {
                            winnerIndex = idx;
                            break;
                        }
                    }

                    // Update embed with track visual
                    let raceDesc = '';
                    for (let idx = 0; idx < HORSES.length; idx++) {
                        const h = HORSES[idx];
                        const pos = Math.min(positions[idx], trackLength);
                        const track = '─'.repeat(pos) + h.label + ' ' + '─'.repeat(Math.max(0, trackLength - pos));
                        raceDesc += `**${h.label} (${h.ratio}x)**\n${track}\n`;
                    }

                    embed.setDescription(raceDesc);
                    await interaction.editReply({ embeds: [embed] });
                }

                // Race finished, determine winners and pay out
                const winningHorse = HORSES[winnerIndex];

                // Build leaderboard embed
                const resultEmbed = new EmbedBuilder()
                    .setTitle(':checkered_flag: Race Finished')
                    .setDescription(`Winner: ${winningHorse.label} (${winningHorse.ratio}x)`)
                    .setColor(Colors.GREEN)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                const winners = [];
                const losers = [];

                for (const [userId, p] of participants.entries()) {
                    // Check user's current balance before settlement
                    const profile = await db.getUser(userId);
                    if (!profile) continue;

                    if (profile.balance < p.bet) {
                        // Insufficient funds at settlement — skip
                        losers.push({ userTag: p.userTag, bet: p.bet, note: 'Insufficient funds' });
                        continue;
                    }

                    if (p.horseId === winningHorse.id) {
                        const payout = Math.floor(p.bet * p.ratio);
                        await db.recordGamePlay(userId, p.bet, payout);

                        // update race stats
                        const stats = await db.getRaceStats(userId);
                        const currentStreak = stats ? (stats.current_win_streak || 0) : 0;
                        await db.setRaceStats(userId, 1, currentStreak + 1);

                        winners.push({ userTag: p.userTag, bet: p.bet, payout });
                    } else {
                        await db.recordGamePlay(userId, p.bet, 0);

                        const stats = await db.getRaceStats(userId);
                        const currentStreak = stats ? (stats.current_win_streak || 0) : 0;
                        await db.setRaceStats(userId, 0, 0);

                        losers.push({ userTag: p.userTag, bet: p.bet });
                    }
                }

                let resultDesc = `**Winner: ${winningHorse.label} (${winningHorse.ratio}x)**\n\n`;
                if (winners.length) {
                    resultDesc += '**Winners**\n';
                    for (const w of winners) resultDesc += `${w.userTag} — Bet ${formatBalance(w.bet)} → Payout ${formatBalance(w.payout)}\n`;
                    resultDesc += '\n';
                }

                if (losers.length) {
                    resultDesc += '**Losers**\n';
                    for (const l of losers) resultDesc += `${l.userTag} — Bet ${formatBalance(l.bet)}${l.note ? ` (${l.note})` : ''}\n`;
                }

                resultEmbed.setDescription(resultDesc);
                await interaction.editReply({ embeds: [resultEmbed], components: [] });
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}