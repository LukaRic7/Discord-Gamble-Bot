const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('crash')
        .setDescription('Start an investment, but cash out before it crashes and you lose the stake.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(100)
            .setMaxValue(500)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);

            // Ensure the user has enough money
            if (profile.balance < betAmount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            let currentMultiplier = 0.5;
            let gameOver = false;

            // Build the initial embed
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(`The multiplier is rising! Cash out before it crashes.`)
                .addFields(
                    { name: 'Stake', value: `${formatBalance(betAmount)}`, inline: true },
                    { name: 'Multiplier', value: `:rocket: **${currentMultiplier.toFixed(2)}x**`, inline: true },
                    { name: 'Profit', value: `${formatBalance(betAmount * currentMultiplier, true)}`, inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            // Cash out button
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cashout')
                    .setEmoji('💵')
                    .setLabel('Cash Out')
                    .setStyle(ButtonStyle.Success)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
            const response = await interaction.fetchReply();

            // Create a collector for the cashout button
            const collector = response.createMessageComponentCollector({ 
                componentType: ComponentType.Button, time: 300000
            });

            // Button collector logic
            collector.on('collect', async (i) => {
                if (i.user.id !== userId) {
                    return i.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });
                }

                // Check if the user has enough money
                if (profile.balance < betAmount) {
                    collector.stop('silent');
                    return await interaction.reply({ 
                        embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                if (i.customId === 'cashout' && !gameOver) {
                    gameOver = true;
                    
                    // Record successful game in DB
                    const payout = betAmount * currentMultiplier;
                    const net = payout - betAmount;
                    const updatedProfile = await db.recordGamePlay(userId, betAmount, payout);
                    await db.setCrashStats(userId, currentMultiplier);

                    embed.setColor(net > 0 ? Colors.GREEN : Colors.RED)
                        .setTitle(':chart_with_upwards_trend: Cashed Out!')
                        .setDescription(`You successfully secured your profits!`)
                        .setFields(
                            { name: 'Stake', value: formatBalance(betAmount), inline: true },
                            { name: 'Multiplier', value: `:rocket: **${currentMultiplier.toFixed(2)}x**`, inline: true },
                            { name: 'Profit', value: formatBalance(net, true), inline: true },
                            { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    // Acknowledge the interaction, updating the message and removing buttons
                    await i.update({ embeds: [embed], components: [] });
                    
                    collector.stop('cashout');
                }
            });

            // Button timed out or ended
            collector.on('end', async (_, reason) => {
                if (reason === 'silent') return;

                // Dont handle timeouts, it'll bust before then

                // If the game ended because it hit the crash point
                if (reason === 'busted') {
                    // Check if the user has enough money
                    const profile = await db.ensureUser(userId);
                    if (profile.balance < betAmount) {
                        return await interaction.reply({ 
                            embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                            flags: MessageFlags.Ephemeral 
                        });
                    }

                    // Record loss in DB (0 payout)
                    const updatedProfile = await db.recordGamePlay(userId, betAmount, 0);

                    embed.setColor(Colors.RED)
                        .setTitle(':boom: Crashed!')
                        .setDescription('The multiplier crashed and you lost your stake.')
                        .setFields(
                            { name: 'Stake', value:formatBalance(betAmount), inline: true },
                            { name: 'Multiplier', value: `:rocket: **${currentMultiplier.toFixed(2)}x**`, inline: true },
                            { name: 'Profit', value: formatBalance(-betAmount), inline: true },
                            { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Gamble Bot' });

                    await interaction.editReply({ embeds: [embed], components: [] });
                }
            });
            
            // Start the game loop
            while (true) {
                await wait(1500);

                if (gameOver) break;

                if (Math.random() > 0.9) {
                    collector.stop('busted');
                    break;
                } else {
                    // Increase the multiplier by 20% each tick for an exponential curve
                    currentMultiplier = currentMultiplier * 1.20;

                    // Game continues, update embed
                    embed.setFields(
                        { name: 'Stake', value: formatBalance(betAmount), inline: true },
                        { name: 'Multiplier', value: `:rocket: **${currentMultiplier.toFixed(2)}x**`, inline: true },
                        { name: 'Profit', value: formatBalance(betAmount * currentMultiplier - betAmount, true), inline: true }
                    );

                    // Catch errors in case Discord API drops edits due to rate limits
                    await interaction.editReply({ embeds: [embed] });
                }
            }
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}