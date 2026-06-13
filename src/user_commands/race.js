const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed, createTimedOutEmbed } = require('../utils/standard_embeds.js');

// Horses configuration
const HORSES = [
    { id: 1, ratio: 2.0 }, { id: 2, ratio: 3.0 }, { id: 3, ratio: 4.0 },
    { id: 4, ratio: 5.0 }, { id: 5, ratio: 6.0 }
];

// Bet options the user can choose from
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
            .setMaxValue(300)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),

    // Callback for when the command is executed
    async execute(interaction) {
        const intermission = interaction.options.getNumber('intermission_duration');
        const db = interaction.client.db;

        // Participants map: userId -> { userTag, horseId, ratio, bet }
        const participants = new Map();

        try {
            const startUnix = Math.floor(Date.now() / 1000) + intermission;

            let raceStarted = false;
            const raceOwnerAuthor = buildAuthor(interaction);

            // Build the horse fields
            const buildHorseFields = () => {
                const fields = [];
                for (const h of HORSES) {
                    // Grab users that voted for that horse
                    const userIds = [...participants]
                        .filter(([_, data]) => data.horseId === h.id)
                        .map(([userId]) => `> <@${userId}>`).join('\n');

                    fields.push({ name: `Horse ${h.id}`, value: `-# Odds: 1:${Math.round(h.ratio)}\n${userIds ? userIds : '> *no bets yet*'}`, inline: false });
                }

                return fields;
            }

            // Helper to edit main embed
            const refreshMainEmbed = async () => {
                embed.setDescription(`Race starts <t:${startUnix}:R>.`)
                    .setFields(...buildHorseFields());
                
                await interaction.editReply({ embeds: [embed] });
            };

            // Build the initial embed showcasing horses and their stats
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(`Race starts <t:${startUnix}:R>.`)
                .setFields(...buildHorseFields())
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            // Join/Leave button row
            const joinButton = new ButtonBuilder().setCustomId('race_join').setLabel('Join Race').setStyle(ButtonStyle.Primary);
            const leaveButton = new ButtonBuilder().setCustomId('race_leave').setLabel('Leave Race').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(joinButton, leaveButton);
            
            await interaction.reply({ embeds: [embed], components: [row] });
            const mainMessage = await interaction.fetchReply();

            // Collector listens to join/leave presses during intermission
            const collector = mainMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: intermission * 1000 });

            // Called when a user joins or leaves the race
            collector.on('collect', async (i) => {
                try {
                    // Only allow valid interactions
                    if (i.customId === 'race_join') {
                        // If user already in race
                        if (participants.has(i.user.id)) {
                            const embed = new EmbedBuilder()
                                .setDescription(':x: You are already in this race!')
                                .setColor(Colors.RED)
                                .setTimestamp()
                                .setFooter({ text: 'Gamble Bot' });

                            return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        const profile = await db.ensureUser(i.user.id);

                        // Build the embed for the horse and bet selector
                        const selectionEmbed = new EmbedBuilder()
                            .setAuthor(buildAuthor(i))
                            .setTitle(':racehorse: Join the Race')
                            .setDescription('Select a horse and an amount of money to bet.')
                            .setFields(
                                { name: 'Horse', value: '*None*', inline: true },
                                { name: 'Stake', value: '*None*', inline: true }
                            )
                            .setColor(Colors.YELLOW)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });
                        
                        // Button to choose a horse
                        const horseButtons = new ActionRowBuilder().addComponents(
                            ...HORSES.map(h => new ButtonBuilder()
                                .setCustomId(`race_pick_horse_${h.id}`)
                                .setLabel(`Horse ${h.id}`)
                                .setStyle(ButtonStyle.Primary))
                        );

                        // Button to choose a bet
                        const betButtons = new ActionRowBuilder().addComponents(
                            ...BET_OPTIONS.map(b => new ButtonBuilder()
                                .setCustomId(`race_pick_bet_${b}`)
                                .setLabel(`${b}`)
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(b > profile.balance))
                        );

                        const abortButton = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('race_join_abort').setLabel('Abort').setStyle(ButtonStyle.Danger)
                        );

                        await i.reply({ embeds: [selectionEmbed], components: [horseButtons, betButtons, abortButton], flags: MessageFlags.Ephemeral });
                        const joinMsg = await i.fetchReply();

                        let chosenHorse = null;
                        let chosenBet = null;
                        let joined = false;

                        // Listen for what the user selects
                        const joinCollector = joinMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

                        // Update using the button interaction, and format the chosenHorse and chosenBet
                        const updateSelectionEmbed = async (btnInteraction) => {
                            const updatedEmbed = EmbedBuilder.from(selectionEmbed).setFields(
                                { name: 'Horse', value: chosenHorse ? `Horse ${chosenHorse.id}` : '*None*', inline: true },
                                { name: 'Stake', value: chosenBet ? formatBalance(chosenBet) : '*None*', inline: true }
                            );
                            await btnInteraction.update({ embeds: [updatedEmbed] });
                        };

                        // Called when a user selects a horse, bet or aborts the joining
                        joinCollector.on('collect', async (btn) => {
                            if (btn.user.id !== i.user.id) return btn.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            // Timeout if the race is started
                            if (raceStarted) {
                                return joinCollector.stop('time');
                            }

                            // Abort joining the race
                            if (btn.customId === 'race_join_abort') {
                                // Build the feedback embed
                                const embed = new EmbedBuilder()
                                    .setDescription(':white_check_mark: You aborted joining the race.')
                                    .setColor(Colors.GREEN)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });
                                
                                await btn.update({ embeds: [embed], components: [] });
                                return joinCollector.stop('aborted');
                            }

                            // Pick a horse or bet
                            if (btn.customId.startsWith('race_pick_horse_')) {
                                chosenHorse = HORSES.find(h => btn.customId.endsWith(`_${h.id}`));
                            } else if (btn.customId.startsWith('race_pick_bet_')) {                                
                                chosenBet = Number(btn.customId.split('_').pop());
                                const currentProfile = await db.getUser(i.user.id);
                                if (!currentProfile || currentProfile.balance < chosenBet) {
                                    chosenBet = null;
                                    return await btn.update({ embeds: [await createInsufficientMoneyEmbed(i, chosenBet)], components: [horseButtons, betButtons, abortButton] });
                                }
                            }

                            // Check if both are ready, if not, just update the embed safely.
                            if (chosenHorse && chosenBet) {
                                participants.set(i.user.id, { id: i.user.id, userTag: i.user.tag, horseId: chosenHorse.id, ratio: chosenHorse.ratio, bet: chosenBet });
                                joined = true;

                                // Build the embed to show the user what they picked
                                const embed = new EmbedBuilder()
                                    .setDescription(`:white_check_mark: You joined the race.`)
                                    .setFields(
                                        { name: 'Horse', value: `:racehorse: Horse ${chosenHorse.id}`, inline: true },
                                        { name: 'Stake', value: formatBalance(chosenBet), inline: true }
                                    )
                                    .setColor(Colors.GREEN)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });

                                await btn.update({ embeds: [embed], components: [] });
                                await refreshMainEmbed();
                                return joinCollector.stop('joined');
                            } else {
                                await updateSelectionEmbed(btn);
                            }
                        });

                        // Called when the embed times out without the user joining
                        joinCollector.on('end', async (_, reason) => {
                            if (!joined && reason === 'time') {
                                await i.editReply({ embeds: [createTimedOutEmbed(i)], components: [] });
                            }
                        });
                    } else if (i.customId === 'race_leave') {
                        // Make sure the user is in the race to leave it
                        if (!participants.has(i.user.id)) {
                            const embed = new EmbedBuilder()
                                .setDescription(':x: You are not in the race.')
                                .setColor(Colors.RED)
                                .setTimestamp()
                                .setFooter({ text: 'Gamble Bot' });

                            return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                        }

                        // Ask for confirmation
                        const confirm = new ButtonBuilder()
                            .setCustomId('race_leave_confirm')
                            .setLabel('Confirm Leave')
                            .setStyle(ButtonStyle.Danger);

                        const cancel = new ButtonBuilder()
                            .setCustomId('race_leave_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const embed = new EmbedBuilder()
                            .setDescription('Are you sure you want to leave the race?')
                            .setColor(Colors.YELLOW)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await i.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(confirm, cancel)], ephemeral: true });
                        const leaveMsg = await i.fetchReply();

                        const leaveCollector = leaveMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

                        leaveCollector.on('collect', async (btn) => {
                            if (btn.user.id !== i.user.id) return btn.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                            if (btn.customId === 'race_leave_confirm') {
                                participants.delete(i.user.id);
                                const embed = new EmbedBuilder()
                                    .setDescription(':white_check_mark: You have left the race.')
                                    .setColor(Colors.GREEN)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });

                                await btn.update({ embeds: [embed], components: [] });
                                await refreshMainEmbed();
                                leaveCollector.stop('left');
                            } else {
                                const embed = new EmbedBuilder()
                                    .setDescription(':x: Leave cancelled.')
                                    .setColor(Colors.GREEN)
                                    .setTimestamp()
                                    .setFooter({ text: 'Gamble Bot' });

                                await btn.update({ embeds: [embed], components: [] });
                                leaveCollector.stop('cancelled');
                            }
                        });
                    }
                } catch (err) {
                    handleInteractionError(i, err);
                }
            });

            // Callback for when the race starts
            collector.on('end', async (_, reason) => {
                raceStarted = true;

                // Remove buttons from main message
                await interaction.editReply({ components: [] });

                // Cancel the race if theres no participants
                if (participants.size === 0) {
                    const noParticipantsEmbed = new EmbedBuilder()
                        .setTitle(':x: No participants')
                        .setDescription('The race started with no participants and has been cancelled.')
                        .setColor(Colors.RED)
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    return await interaction.editReply({ embeds: [noParticipantsEmbed], components: [] });
                }

                // Start the race
                const trackLength = 40;
                const positions = HORSES.map(() => 0);

                let winnerIndex = -1;

                // Keep moving horses until theres a winner
                while (winnerIndex === -1) {
                    await wait(1500);

                    // Advance each horse based on their odds
                    for (let idx = 0; idx < HORSES.length; idx++) {
                        const h = HORSES[idx];
                        
                        // Base movement
                        let step = Math.floor(Math.random() * 3) + 1;
                        
                        // Odds advantage
                        if (Math.random() < (1 / h.ratio)) step += 2; 
                        
                        // High Variance
                        if (Math.random() < 0.10) {
                            step += Math.floor(Math.random() * 4) + 2; 
                        }
                    
                        positions[idx] += step;
                        
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
                        
                        const spacesToFinish = Math.max(0, trackLength - pos);
                        
                        const spacesCovered = pos;
                        
                        const track = `\\_\\_|${'\\_'.repeat(spacesToFinish)}:racehorse:${'\\_'.repeat(spacesCovered)}(${h.id})`;
                        
                        raceDesc += `**Horse ${h.id} (1 : ${h.ratio})**\n${track}\n`;
                    }

                    embed.setDescription(raceDesc);
                    await interaction.editReply({ embeds: [embed] });
                }

                await wait(1500);

                // Race finished, determine winners and pay out
                const winningHorse = HORSES[winnerIndex];

                const winners = [];
                const losers = [];
                const participantResults = [];

                // Iterate over all participants
                for (const [userId, p] of participants.entries()) {
                    const profile = await db.getUser(userId);
                    if (!profile) continue;

                    let profit = 0;
                    let newBalance = profile.balance;
                    let resultType = 'lose';

                    if (profile.balance < p.bet) {
                        losers.push({ userTag: p.userTag, stake: p.bet, horse: p.horseId, note: 'Insufficient Funds' });
                        profit = 0;
                        newBalance = profile.balance;
                    } else if (p.horseId === winningHorse.id) {
                        const payout = Math.floor(p.bet * p.ratio);
                        profit = payout - p.bet;
                        const updatedProfile = await db.recordGamePlay(userId, p.bet, payout);

                        const stats = await db.getRaceStats(userId);
                        const currentStreak = stats ? (stats.current_win_streak || 0) : 0;
                        await db.setRaceStats(userId, 1, currentStreak + 1);
                        
                        newBalance = updatedProfile.balance;
                        winners.push({ id: p.id, userTag: p.userTag, stake: p.bet, horse: p.horseId, profit, newBalance: updatedProfile.balance });
                        resultType = 'win';
                    } else {
                        profit = -p.bet;
                        const updatedProfile = await db.recordGamePlay(userId, p.bet, 0);

                        const stats = await db.getRaceStats(userId);
                        await db.setRaceStats(userId, 0, 0);

                        newBalance = updatedProfile.balance;
                        losers.push({ id: p.id, userTag: p.userTag, stake: p.bet, horse: p.horseId, profit, newBalance: updatedProfile.balance });
                    }

                    participantResults.push({ userId, userTag: p.userTag, stake: p.bet, horse: p.horseId, profit, newBalance, resultType });
                }

                // Build the embed to hold the results
                const resultEmbed = new EmbedBuilder()
                    .setTitle(':checkered_flag: Race Finished')
                    .setDescription(`The winning horse is: :racehorse: **Horse ${winningHorse.id}** (${winningHorse.ratio.toFixed(2)}x)`)
                    .setColor(Colors.GREEN)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                // Build winner field
                const winnerField = winners.length
                    ? { name: 'Winners', value: winners.map(w => `> <@${w.id}> (**${formatBalance(w.profit, true)}**)`).join('\n'), inline: false }
                    : { name: 'Winners', value: '*No winners this race.*', inline: false };

                // Build loser field
                const loserField = losers.length
                    ? { name: 'Losers', value: losers.map(l => `> <@${l.id}> (**${formatBalance(l.profit, true)}**)`).join('\n'), inline: false }
                    : { name: 'Losers', value: '*No losers this race.*', inline: false };

                resultEmbed.addFields(winnerField, loserField);
                await interaction.editReply({ embeds: [resultEmbed], components: [] });

                // Show each participant their own ephemeral result
                for (const result of participantResults) {
                    try {
                        const user = await interaction.client.users.fetch(result.userId);
                        const dmEmbed = new EmbedBuilder()
                            .setAuthor(raceOwnerAuthor)
                            .setTitle(':horse_racing: Race Result')
                            .setDescription('The race is over. Here are your results!')
                            .addFields(
                                { name: 'Stake', value: formatBalance(result.stake), inline: true },
                                { name: 'Horse Bet', value: `Horse ${result.horse}`, inline: true },
                                { name: 'Winning Horse', value: `Horse ${winningHorse.id}`, inline: true },
                                { name: 'Profit', value: formatBalance(result.profit, true), inline: true },
                                { name: 'New Balance', value: `:moneybag: **${formatBalance(result.newBalance)}**`, inline: true }
                            )
                            .setColor(result.resultType === 'win' ? Colors.GREEN : Colors.RED)
                            .setTimestamp()
                            .setFooter({ text: 'Gamble Bot' });

                        await user.send({ embeds: [dmEmbed], flags: MessageFlags.Ephemeral });
                    } catch {
                        // Ignore DM failures silently.
                    }
                }
            });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}