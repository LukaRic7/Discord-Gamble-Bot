const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError, wait } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed } = require('../utils/standard_embeds.js');

function buildPlinkoCodeBlock(positionHistory, gameOver=false) {
    const multipliers = [9.0, 3.5, 1.5, 0.3, 1.5, 3.5, 9.0];
    const rowCount = positionHistory.length;

    let rows = [];

    for (let i = 0; i < rowCount; i++) {
        let row = [];

        // spacing before the row
        row.push(' '.repeat(3 * (rowCount - i)));

        for (let j = 0; j <= i; j++) {
            if (positionHistory[i] === j - Math.floor(i / 2)) {
                row.push('●');
            } else {
                row.push('·');
            }

            row.push('  ');
        }

        rows.push(row.join(''));
    }

    rows.push('| ' + multipliers.map(x => x + 'x').join(' | ') + ' |');

    if (gameOver) {
        const final = positionHistory[positionHistory.length - 1];

        rows.push(
            '| ' +
            multipliers.map((_, i) => i === final ? ' ⬤ ' : '   ')
            .join('|') +
            '|'
        );
    }

    return rows.join('\n');
}

module.exports = {
    // Contains the slash command instance
    data: new SlashCommandBuilder()
        .setName('plinko')
        .setDescription('Play a game of plinko.')
        .addNumberOption((option) => option
            .setName('stake')
            .setDescription('Amount to bet.')
            .setRequired(true)
            .setMinValue(200)
            .setMaxValue(1000)
        )
        .setContexts(
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ),
    
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

            // Build the initial embed
            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setDescription(buildPlinkoCodeBlock([]))
                .setFields(
                    { name: 'Stake', value: formatBalance(betAmount), inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed] });

            let pos = 0;
            const history = [];
            for (let i = 0; i < 6; i++) {
                // move left/right
                pos += Math.random() < 0.5 ? -1 : 1;
        
                // keep inside board
                pos = Math.max(0, Math.min(i + 1, pos));
        
                history.push(pos);

                embed.setDescription(buildPlinkoCodeBlock(history));
                interaction.editReply({ embeds: [embed] });

                await wait(1500);
            }

            // Handle winning later

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
}