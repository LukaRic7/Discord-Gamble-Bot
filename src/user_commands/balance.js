const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createUserDoesNotExistEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('View your balance.')
        .addUserOption((option) => option
            .setName('user')
            .setDescription('The users balance to view (leave blank for yourself).')
            .setRequired(false)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const db = interaction.client.db;

        try {
            // Only create a profile if own balance is checked
            let profile;
            if (!interaction.options.getUser('user')) {
                profile = await db.ensureUser(targetUser.id);
            } else {
                profile = await db.getUser(targetUser.id);
            }

            // Make sure the user exists
            if (!profile) {
                return await interaction.reply({ embeds: [createUserDoesNotExistEmbed(targetUser.id)] });
            }

            // Build the embed showing the users balance
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction, targetUser))
                .setDescription(`:moneybag: **${formatBalance(profile.balance)}**`)
                .setColor(Colors.CORE)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            await handleInteractionError(interaction, error);
        }
    }
}