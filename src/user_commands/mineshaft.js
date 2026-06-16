const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType} = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

/**
 * Generates a right-skewed random hourly rate.
 * Most values are near the mean, rare high rolls happen.
 *
 * @param {number} mean Target average hourly rate
 * @param {number} spread Higher = more extreme rare rolls
 * @returns {number} Random hourly rate
 */
function rollRandomHourlyRate(mean=80, spread=0.7) { // Originally mean=40
    // Box-Muller normal distribution
    const u = Math.random();
    const v = Math.random();

    const normal =
        Math.sqrt(-2 * Math.log(u)) *
        Math.cos(2 * Math.PI * v);

    // Convert normal -> log-normal
    const value = mean * Math.exp(normal * spread - (spread * spread) / 2);

    return Math.floor(value * 100) / 100;
}

/**
 * Builds Discord embed field data for the miner status panel.
 *
 * Calculates and formats the user's mining-related statistics,
 * including hourly rate, last claim time, and currently accumulated
 * unclaimed earnings based on elapsed time.
 *
 * @param {Object} stats - User miner statistics object
 * @param {number} stats.miner_hourly_rate - Current hourly earning rate of the miner
 * @param {string|Date|number} [stats.last_miner_claim] - Timestamp of the last claim action
 *
 * @returns {Array<{name: string, value: string, inline: boolean}>}
 * An array of Discord embed field objects containing:
 * - Hourly Rate (formatted currency/value)
 * - Last Claim (relative Discord timestamp or "Never")
 * - Ready To Claim (calculated passive earnings since last claim)
 */
function createFields(stats) {
    let lastClaim = '*Never*';
    let readyToClaim = 0;
    
    if (stats.last_miner_claim) {
        const lastClaimTime = new Date(stats.last_miner_claim).getTime();
        const currentTime = new Date().getTime();
        const secondsElapsed = Math.floor((currentTime - lastClaimTime) / 1000);
        const secondlyRate = stats.miner_hourly_rate / 3600;
        readyToClaim = secondsElapsed * secondlyRate;
        
        // Format the timestamp for Discord's relative time format
        const timestamp = Math.floor(lastClaimTime / 1000);
        lastClaim = `<t:${timestamp}:R>`;
    }

    return [
        { name: 'Hourly Rate', value: `:stopwatch: ${formatBalance(stats.miner_hourly_rate, true)}`, inline: true },
        { name: 'Last Claim', value: lastClaim, inline: true },
        { name: 'Ready To Claim', value: `:bank: **${formatBalance(readyToClaim, true)}**`, inline: true }
    ];
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('mineshaft')
        .setDescription('Open the mineshaft, this is where you earn passive income.')
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
        
    // Callback for when the command is executed
    async execute(interaction) {
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const stats = await db.getMinerStats(userId);

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(':pick: ' + (stats.miner_hourly_rate === 0 ? 'Purchase a miner to start earning passive income.' : 'Your miner has been hard at work.'))
                .setFields(...createFields(stats))
                .setColor(Colors.CORE)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            // Build the action row containing buttons
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rollnew')
                    .setEmoji('🎲')
                    .setLabel('Roll New ($1,000)')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('claim')
                    .setEmoji('🏦')
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Primary)
            );

            // Send the miner embed
            await interaction.reply({ embeds: [embed], components: [row] });
            const response = await interaction.fetchReply();

            // Start an event collector for the buttons
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600000 });

            // Callback for when a button is pressed
            collector.on('collect', async i => {
                // Ensure only the person who ran the command can click the buttons
                if (i.user.id !== userId) {
                    return await i.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });
                }

                if (i.customId === 'rollnew') {
                    // Ensure the user has enough money
                    const profile = await db.ensureUser(userId);
                    if (profile.balance < 10) {
                        return await i.reply({
                            embeds: [await createInsufficientMoneyEmbed(interaction, 1000)],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    // Subtract the money from the users account
                    await db.addBalance(userId, -1000);

                    // Roll a new miner hourly rate
                    const newRate = rollRandomHourlyRate();
                    const currentRate = stats.miner_hourly_rate;

                    let resultEmbed = new EmbedBuilder()
                        .setAuthor(buildAuthor(interaction))
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    if (newRate > currentRate) {
                        // Successful upgrade
                        const beforeProfile = await db.getUser(userId);
                        await db.setNewMinerHourly(userId, newRate);
                        const updatedStats = await db.getMinerStats(userId);
                        const afterProfile = await db.getUser(userId);

                        const amountClaimed = afterProfile.balance - profile.balance;
                        
                        resultEmbed
                            .setTitle(':tada: Better Miner Found!')
                            .setDescription('You found a more efficient miner!\nPrevious mined goods have been collected!')
                            .addFields(
                                { name: 'Old Rate', value: formatBalance(currentRate, true), inline: true },
                                { name: 'New Rate', value: formatBalance(newRate, true), inline: true },
                                { name: 'Improvement', value: formatBalance(newRate - currentRate, true), inline: true },
                                { name: 'Amount Claimed', value: formatBalance(amountClaimed == 1000 ? 0 : amountClaimed, true), inline: true },
                                { name: 'New Balance', value: `:moneybag: **${formatBalance(afterProfile.balance)}**`, inline: true }
                            )
                            .setColor(Colors.GREEN);

                        // Update the main embed with new stats
                        stats.miner_hourly_rate = newRate;
                        stats.last_miner_claim = updatedStats.last_miner_claim;
                        embed.setFields(...createFields(stats));
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        // Failed upgrade
                        const profile = await db.ensureUser(userId);
                        resultEmbed
                            .setTitle(':x: Worse Miner Found')
                            .setDescription(`The miner you found is less efficient.\nYour current miner is still better.`)
                            .addFields(
                                { name: 'Current Rate', value: `${formatBalance(currentRate, true)}`, inline: true },
                                { name: 'New Rate', value: `${formatBalance(newRate, true)}`, inline: true },
                                { name: 'Difference', value: `${formatBalance(newRate - currentRate, true)}`, inline: true },
                                { name: 'New Balance', value: `:moneybag: **${formatBalance(profile.balance)}**`, inline: false }
                            )
                            .setColor(Colors.RED);
                    }

                    await i.reply({ embeds: [resultEmbed], flags: MessageFlags.Ephemeral });
                } else if (i.customId === 'claim') {
                    // Claim the earned money from the miner
                    const claimResult = await db.claimMinerEarned(userId);
                    const earnedAmount = (claimResult && claimResult.earnedAmount) ? claimResult.earnedAmount : 0;
                    const updatedProfile = await db.getUser(userId);

                    const resultEmbed = new EmbedBuilder()
                        .setAuthor(buildAuthor(interaction))
                        .setTitle(':moneybag: Miner Earnings Claimed!')
                        .setDescription(`Your miner has been working hard.`)
                        .addFields(
                            { name: 'Amount Claimed', value: `:bank: ${formatBalance(earnedAmount, true)}`, inline: true },
                            { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: true }
                        )
                        .setColor(Colors.GREEN)
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    // Update the main embed with new stats
                    stats.last_miner_claim = claimResult.last_miner_claim;
                    embed.setFields(...createFields(stats));
                    await interaction.editReply({ embeds: [embed] });

                    await i.reply({ embeds: [resultEmbed], flags: MessageFlags.Ephemeral });
                }
            });

            // Callback for when the collector times out
            collector.on('end', async (_, reason) => {
                // Remove buttons from embed when timeout expires
                if (reason === 'time') {
                    await interaction.editReply({ components: [] });
                }
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}