const { EmbedBuilder } = require('discord.js');

const { Colors, formatBalance, buildAuthor } = require('../utils/standards.js');

/**
 * Builds an embed for insufficient funds and shows the user's current balance.
 * @param {import('discord.js').CommandInteraction} interaction - The interaction object.
 * @param {number} betAmount - The amount required for the requested action.
 * @returns {Promise<import('discord.js').EmbedBuilder>} A Discord embed describing the funding shortfall.
 */
async function createInsufficientMoneyEmbed(interaction, betAmount) {
    const profile = await interaction.client.db.ensureUser(interaction.user.id);
    
    return new EmbedBuilder()
        .setAuthor(buildAuthor(interaction))
        .setDescription(':x: Insufficient funds!')
        .addFields(
            { name: 'Needed', value: `:money_with_wings: ${formatBalance(betAmount)}`, inline: true },
            { name: 'Difference', value: `:scales: ${formatBalance(betAmount - profile.balance)}`, inline: true },
            { name: 'Balance', value: `:moneybag: **${formatBalance(profile.balance)}**`, inline: false }
        )
        .setColor(Colors.RED)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });
}

/**
 * Builds an embed for unauthorized interaction ownership.
 * @returns {Promise<import('discord.js').EmbedBuilder>} A Discord embed indicating the interaction is not owned by the user.
 */
function createIlligalInteractionEmbed() {
    return new EmbedBuilder()
        .setDescription(":no_entry_sign: You don't own this interaction!")
        .setColor(Colors.RED)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });
}

/**
 * Creates an embed notifying that a user does not have a gambling profile.
 * @param {string} userId - The Discord user ID of the missing profile.
 * @returns {EmbedBuilder} A red embed indicating the user has no gambling profile.
 */
function createUserDoesNotExistEmbed(userId) {
    return new EmbedBuilder()
        .setDescription(`The user <@${userId}> does not have a gambling profile!`)
        .setColor(Colors.RED)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });
}

/**
 * Creates an embed indicating that a user interaction timed out.
 * @param {Interaction} interaction - The Discord interaction used to build the author field.
 * @returns {EmbedBuilder} A gray embed warning that the user took too long to respond and the bet was returned.
 */
function createTimedOutEmbed(interaction) {
    return new EmbedBuilder()
        .setAuthor(buildAuthor(interaction))
        .setDescription(':hourglass: You took too long to respond. Your bet was returned.')
        .setColor(Colors.GRAY)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });
}

module.exports = { createInsufficientMoneyEmbed, createIlligalInteractionEmbed, createUserDoesNotExistEmbed, createTimedOutEmbed };