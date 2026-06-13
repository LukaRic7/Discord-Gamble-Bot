const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('war')
        .setDescription('Pull a card against a dealer, highest card wins.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(250)
            .setMaxValue(1000)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setDescription(':tools: This feature is under development!')
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed], components: [row] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}