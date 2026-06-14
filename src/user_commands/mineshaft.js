const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType} = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

/**
 * Generates a random hourly rate for a miner roll.
 * Rates range from 50 to 500 with an average around 200.
 * @returns {number} A random hourly rate value.
 */
function rollRandomHourlyRate() {
    // Generate a value between 50 and 500
    return Math.floor(Math.random() * 450) + 50;
}

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
        .setDescription('Open the mineshaft window, this is where you earn passive income.')
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
        
    // Callback for when the command is executed
    async execute(interaction) {
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);
            const stats = await db.getMinerStats(userId);

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(':pick: ' + (stats.miner_hourly_rate === 0 ? 'Purchase a miner to start earning passive income.' : 'Your miner has been at hard work'))
                .setFields(...createFields(stats))
                .setColor(Colors.GREEN)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' })

            // Build the action row containing buttons
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rollnew')
                    .setEmoji(':die:')
                    .setLabel('Roll New')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('claim')
                    .setEmoji(':bank:')
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
                    // Roll a new miner hourly rate
                    const newRate = rollRandomHourlyRate();
                    const currentRate = stats.miner_hourly_rate;
                    
                    let resultEmbed = new EmbedBuilder()
                        .setAuthor(buildAuthor(interaction))
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    if (newRate > currentRate) {
                        // Successful upgrade
                        await db.setNewMinerHourly(userId, newRate);
                        const updatedStats = await db.getMinerStats(userId);
                        
                        resultEmbed
                            .setTitle(':tada: Better Miner Found!')
                            .setDescription(`You found a more efficient miner!`)
                            .addFields(
                                { name: 'Old Rate', value: `${formatBalance(currentRate, true)}`, inline: true },
                                { name: 'New Rate', value: `${formatBalance(newRate, true)}`, inline: true },
                                { name: 'Improvement', value: `+${formatBalance(newRate - currentRate, true)}`, inline: true }
                            )
                            .setColor(Colors.GREEN);

                        // Update the main embed with new stats
                        stats.miner_hourly_rate = newRate;
                        stats.last_miner_claim = updatedStats.last_miner_claim;
                        embed.setFields(...createFields(stats));
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        // Failed upgrade
                        resultEmbed
                            .setTitle(':x: Worse Miner Found')
                            .setDescription(`The miner you found is less efficient. Your current miner is still better.`)
                            .addFields(
                                { name: 'Current Rate', value: `${formatBalance(currentRate, true)}`, inline: true },
                                { name: 'New Rate', value: `${formatBalance(newRate, true)}`, inline: true },
                                { name: 'Difference', value: `${formatBalance(newRate - currentRate, true)}`, inline: true }
                            )
                            .setColor(Colors.RED);
                    }

                    await i.reply({ embeds: [resultEmbed], flags: MessageFlags.Ephemeral });

                } else if (i.customId === 'claim') {
                    // Claim the earned money from the miner
                    const preClaimStats = await db.getMinerStats(userId);
                    const lastClaimTime = new Date(preClaimStats.last_miner_claim).getTime();
                    const currentTime = new Date().getTime();
                    const secondsElapsed = Math.floor((currentTime - lastClaimTime) / 1000);
                    const secondlyRate = preClaimStats.miner_hourly_rate / 3600;
                    const earnedAmount = secondsElapsed * secondlyRate;

                    const updatedStats = await db.claimMinerEarned(userId);
                    const updatedProfile = await db.getUser(userId);

                    const resultEmbed = new EmbedBuilder()
                        .setAuthor(buildAuthor(interaction))
                        .setTitle(':moneybag: Miner Earnings Claimed!')
                        .setDescription(`Your miner has been working hard.`)
                        .addFields(
                            { name: 'Amount Claimed', value: `:bank: **${formatBalance(earnedAmount, true)}**`, inline: true },
                            { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: true }
                        )
                        .setColor(Colors.GREEN)
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    // Update the main embed with new stats
                    stats.last_miner_claim = updatedStats.last_miner_claim;
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