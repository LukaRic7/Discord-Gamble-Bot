const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createUserDoesNotExistEmbed } = require('../utils/standard_embeds.js');

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Pay another user a sum of money. A 5% fee will be applied!')
        .addNumberOption((option) => option
            .setName('amount')
            .setDescription('Amount to pay.')
            .setRequired(true)
            .setMinValue(5)
            .setMaxValue(10000)
        )
        .addMentionableOption((option) => option
            .setName('recipient')
            .setDescription('The user that receives the money.')
            .setRequired(true)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
    // Callback for when the command is executed
    async execute(interaction) {
        const amount = interaction.options.getNumber('amount');
        const recipient = interaction.options.getMentionable('recipient');
        const senderId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const senderProfile = await db.ensureUser(senderId);

            // Ensure the user has enough money
            if (senderProfile.balance < amount) {
                return await interaction.reply({
                    embeds: [await createInsufficientMoneyEmbed(interaction, amount)],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Check if the recipient exists
            const recipientProfile = await db.getUser(recipient.id);
            if (!recipientProfile) {
                return await interaction.reply({ embeds: [createUserDoesNotExistEmbed(recipient.id)] });
            }

            const fee = amount * 0.05;

            const newProfiles = await db.transferMoney(senderId, recipient.id, amount, fee);

            // Build the embed
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(`:money_with_wings: You Transfered Money!`)
                .setFields(
                    { name: 'Amount', value: formatBalance(amount - fee), inline: true },
                    { name: 'Fee (5%)', value: formatBalance(fee), inline: true },
                    { name: `${interaction.user.globalName || interaction.user.username}'s Balance`, value: `:moneybag: **${formatBalance(newProfiles[0].balance)}**`, inline: false },
                    { name: `${recipient.globalName || recipient.username}'s Balance`, value: `:moneybag: **${formatBalance(newProfiles[1].balance)}**`, inline: false }
                )
                .setColor(Colors.GREEN)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });
            
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}