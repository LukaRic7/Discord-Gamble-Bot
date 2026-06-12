const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Bet on a coin flip. Win earns an equal stake payout, lose loses your stake.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(500)
        )
        .addStringOption((option) => option
            .setName('choice')
            .setDescription('Select heads or tails (Default is heads).')
            .addChoices(
                { name: 'Heads', value: 'Heads' },
                { name: 'Tails', value: 'Tails' }
            )
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const betAmount = interaction.options.getNumber('stake');
        const choice = interaction.options.getString('choice') || 'Heads';
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

            // Play the game
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            const isWin = result == choice;
            const winAmount = isWin ? (betAmount * 2) : 0;

            // Update database
            const updatedProfile = await db.recordGamePlay(userId, betAmount, winAmount);
            const stats = await db.getCoinflipStats(userId);
            const newStreak = isWin ? stats.current_win_streak + 1 : 0;
            await db.setCoinflipStats(userId, newStreak);

            // Build the embed to display the game result            
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(isWin ? ':tada: Winner Winner!' : ':money_with_wings: Better Luck Next Time!')
                .setDescription(`The coin landed on **${result}**`)
                .addFields(
                    { name: 'Stake', value: `${formatBalance(betAmount)}`, inline: true },
                    { name: 'Profit', value: `${formatBalance(winAmount - betAmount, true)}`, inline: true },
                    { name: 'Streak', value: `:fire: ${newStreak}`, inline: true },
                    { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                )
                .setColor(isWin ? Colors.GREEN : Colors.RED)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            await handleInteractionError(interaction, error);
        }
    }
}