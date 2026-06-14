const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

const SLOTS = [':cherries:', ':lemon:', ':grapes:', ':watermelon:', ':bell:', ':gem:', ':seven:'];

/**
 * Generates a random slot machine result.
 *
 * Selects three random symbols from the available slot symbols
 * to create a spin outcome.
 *
 * @returns {Array<string>} Array containing the three generated slot symbols.
 */
function getSlotResult() {
    return [
        SLOTS[Math.floor(Math.random() * SLOTS.length)],
        SLOTS[Math.floor(Math.random() * SLOTS.length)],
        SLOTS[Math.floor(Math.random() * SLOTS.length)]
    ];
}

/**
 * Calculates the payout result for a slot spin.
 *
 * Determines the multiplier based on matching symbols and identifies
 * whether a jackpot was achieved.
 *
 * @param {number} stake - The amount wagered on the spin.
 * @param {Array<string>} result - Array containing the slot spin symbols.
 * @returns {Object} Object containing payout amount, multiplier, and jackpot status.
 */
function calculatePayout(stake, result) {
    let multiplier = 0;
    let hitJackpot = false;

    // 3 of a kind
    if (result[0] === result[1] && result[1] === result[2]) {
        switch (result[0]) {
            case ':seven:': multiplier = 50; hitJackpot = true; break;
            case ':gem:': multiplier = 25; break;
            case ':bell:': multiplier = 10; break;
            default: multiplier = 5; break; // Fruit 3-of-a-kind
        }
    } 
    // 2 of a kind (any two matching)
    else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
        multiplier = 1.5; 
    }

    return { payout: stake * multiplier, multiplier, hitJackpot };
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Take a spin on the slot machine.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(50)
            .setMaxValue(150)
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

            // Pre-calculate the result so we know the outcome before revealing
            const finalSymbols = getSlotResult();
            const { payout, multiplier, hitJackpot } = calculatePayout(betAmount, finalSymbols);
            const isWin = payout > 0;

            // Fetch slot stats or default if none exist
            const slotStats = await db.getSlotsStats(userId) || { current_win_streak: 0 };
            let currentStreak = slotStats.current_win_streak;

            // Build the initial spinning embed
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(`\n**→ [ :question: | :question: | :question: ] ←**\n`)
                .addFields(
                    { name: 'Stake', value: `${formatBalance(betAmount)}`, inline: true },
                    { name: 'Streak', value: `:fire: ${currentStreak}`, inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed] });
            const response = await interaction.fetchReply();

            // Reveal phases
            const revealPhases = [
                `**→ [ ${finalSymbols[0]} | :question: | :question: ] ←**`,
                `**→ [ ${finalSymbols[0]} | ${finalSymbols[1]} | :question: ] ←**`,
                `**→ [ ${finalSymbols[0]} | ${finalSymbols[1]} | ${finalSymbols[2]} ] ←**`
            ];

            // Enter a loop that slowly reveals the wheel results
            for (let i = 0; i < revealPhases.length; i++) {
                await wait(1500);
                
                embed.setTitle(`\n${revealPhases[i]}\n`);

                // If it's the final reveal, format the embed with the results
                if (i === revealPhases.length - 1) {                    
                    currentStreak = isWin ? currentStreak + 1 : 0;

                    // Check if the user has enough money
                    const profile = await db.ensureUser(userId);
                    if (profile.balance < betAmount) {
                        return await interaction.reply({ 
                            embeds: [await createInsufficientMoneyEmbed(interaction, betAmount)], 
                            flags: MessageFlags.Ephemeral 
                        });
                    }

                    // Update DB with the results
                    const updatedProfile = await db.recordGamePlay(userId, betAmount, payout);
                    await db.setSlotsStats(userId, currentStreak, hitJackpot ? 1 : 0);

                    // Edit the embed to show winner results
                    embed.setTitle(':slot_machine: ' + (isWin ? (hitJackpot ? 'Jackpot!' : 'Winner!') : 'You Lost!'))
                        .setDescription(`\n${revealPhases[i]}\n`)
                        .setColor(isWin ? Colors.GREEN : Colors.RED)
                        .setFields(
                            { name: 'Stake', value: formatBalance(betAmount), inline: true },
                            { name: 'Profit', value: formatBalance(payout - betAmount, true), inline: true },
                            { name: 'Streak', value: `:fire: ${currentStreak}`, inline: true },
                            { name: 'New Balance', value: `:moneybag: ${formatBalance(updatedProfile.balance)}`, inline: false }
                        );
                }

                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}