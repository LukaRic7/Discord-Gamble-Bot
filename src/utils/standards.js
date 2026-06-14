const { MessageFlags, EmbedBuilder } = require('discord.js');

/**
 * Contains constants for preset colors.
 */
class Colors {
    static RED = '#e74c3c'
    static GREEN = '#2ecc71'
    static YELLOW = '#f1c40f'
    static GRAY = '#95a5a6'
    static CORE = '#9b59b6'
}

/**
 * Formats a numeric balance into a USD currency string with optional sign.
 * @param {number} balance - The numeric balance to format.
 * @param {boolean} [addSignOnPositive=false] - Whether to prepend a '+' sign for positive values.
 * @returns {string} The formatted balance string (e.g., "$1,234.00", "-$50.00").
 */
function formatBalance(balance, addSignOnPositive=false) {
    const normalized = Math.round(balance * 100) / 100;

    const isNegative = normalized < 0;

    const formatter = Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });

    const sign = isNegative ? '-' : (addSignOnPositive ? '+' : '');

    return `${sign}$${formatter.format(Math.abs(normalized))}`;
}

/**
 * Converts a string into title case.
 * @param {string} str - The input string to convert.
 * @returns {string} The title-cased string.
 */
function titleCase(str) {
    return String(str)
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Builds a Discord embed author object based on an interaction and optional user override.
 * @param {CommandInteraction} interaction - The Discord interaction used for context.
 * @param {User} [user=null] - Optional user override; defaults to interaction user.
 * @returns {{name: string, iconURL: string}} The formatted author object for embeds.
 */
function buildAuthor(interaction, user=null) {
    user = user || interaction.user;
    
    return {
        name: `${user.globalName || user.username}'s ${titleCase(interaction.commandName)}`,
        iconURL: (user).displayAvatarURL()
    }
}

/**
 * Handles errors occurring during a Discord interaction by logging and responding with an embed.
 * @param {CommandInteraction} interaction - The Discord interaction where the error occurred.
 * @param {Error} error - The thrown error object.
 * @returns {Promise<void>} Resolves after sending or replying with the error embed.
 */
async function handleInteractionError(interaction, error) {
    console.error(error);

    const embed = new EmbedBuilder()
        .setDescription(`:x: Sorry, an unaccounted **${error.name}** has occurred!`)
        .setColor(Colors.RED)
        .setTimestamp()
        .setFooter({ text: 'Gamble Bot' });

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}

/**
 * Creates a delay for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { Colors, formatBalance, titleCase, buildAuthor, handleInteractionError, wait };