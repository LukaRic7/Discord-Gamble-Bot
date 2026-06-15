const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType} = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('chests')
        .setDescription('Open the correct chest and triple your stake, open the wrong chest loses your stake.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(250)
            .setMaxValue(750)
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

            // Check if the user has enough money
            if (profile.balance < betAmount) {
                return await interaction.reply({ 
                    embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                    flags: MessageFlags.Ephemeral
                });
            }

            // Build the 5 Interactive Buttons
            const buttons = [];
            for (let i = 0; i < 5; i++) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`chest_${i}`)
                        .setEmoji('🎁')
                        .setStyle(ButtonStyle.Secondary)
                );
            }
            const row = new ActionRowBuilder().addComponents(buttons);

            // Build the initial embed to show the 5 buttons
            const stats = await db.getChestsStats(userId);
            const initialEmbed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription('Pick one of the chests below. One holds a **4.5x payout**, the others are empty!')
                .addFields(
                    { name: 'Stake', value: formatBalance(betAmount), inline: true },
                    { name: 'Streak', value: `:fire: ${stats.current_win_streak}`, inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            // Send the initial message and store the response to attach a collector to it
            await interaction.reply({ embeds: [initialEmbed], components: [row] });
            const response = await interaction.fetchReply();

            // Create the Collector
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            // Callback for the buttons
            collector.on('collect', async i => {
                // Ensure only the person who ran the command can click the buttons
                if (i.user.id !== userId) {
                    return await i.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });
                }
                
                // Check if the user has enough money
                if (profile.balance < betAmount) {
                    collector.stop('silent');
                    return await interaction.reply({ 
                        embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                // Determine which button they clicked
                const clickedIndex = parseInt(i.customId.split('_')[1]);

                // Game Logic (20% Win Chance)
                const isWin = Math.random() < 0.20;
                const winAmount = isWin ? (betAmount * 4.5) : 0;
                
                // Determine where the winning chest actually is to show them
                let winningIndex = clickedIndex;
                if (!isWin) {
                    // Pick a random chest that ISN'T the one they clicked
                    do {
                        winningIndex = Math.floor(Math.random() * 5);
                    } while (winningIndex === clickedIndex);
                }

                // Database Transactions
                const updatedProfile = await db.recordGamePlay(userId, betAmount, winAmount);
                const stats = await db.getChestsStats(userId);
                const newStreak = isWin ? stats.current_win_streak + 1 : 0;
                await db.updateChestsStats(userId, newStreak);

                // Reveal the Chests
                const updatedButtons = [];
                for (let j = 0; j < 5; j++) {
                    const btn = new ButtonBuilder().setCustomId(`revealed_${j}`).setDisabled(true);

                    if (j === clickedIndex) {
                        // The chest the user clicked
                        btn.setEmoji(isWin ? '💎' : '🕸️');
                        btn.setStyle(isWin ? ButtonStyle.Success : ButtonStyle.Danger);
                    } else if (j === winningIndex) {
                        // The chest that had the treasure (if they missed it)
                        btn.setEmoji('💎');
                        btn.setStyle(ButtonStyle.Secondary);
                    } else {
                        // Empty chests
                        btn.setEmoji('🕸️');
                        btn.setStyle(ButtonStyle.Secondary);
                    }
                    updatedButtons.push(btn);
                }
                const updatedRow = new ActionRowBuilder().addComponents(updatedButtons);

                // Build the result embed
                const resultEmbed = new EmbedBuilder()
                    .setAuthor(buildAuthor(interaction))
                    .setTitle(isWin ? ':gem: Treasure Found!' : ':spider_web: Empty Chest!')
                    .setDescription(isWin ? 'You picked the right chest and tripled your stake!' : 'Dust and cobwebs... Better luck next time.')
                    .addFields(
                        { name: 'Stake', value: formatBalance(betAmount), inline: true },
                        { name: 'Profit', value: formatBalance(winAmount - betAmount, true), inline: true },
                        { name: 'Streak', value: `:fire: ${newStreak}`, inline: true },
                        { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                    )
                    .setColor(isWin ? Colors.GREEN : Colors.RED)
                    .setTimestamp()
                    .setFooter({ text: 'Gamble Bot' });

                // Acknowledge the interaction and edit the original message seamlessly
                await i.update({ embeds: [resultEmbed], components: [updatedRow] });
                
                // Stop the collector since the game is over
                collector.stop();
            });

            // Handle timeouts
            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ embeds: [createTimedOutEmbed(interaction)], components: [] });
                } else if (reason === 'silent') {
                    return;
                }
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}