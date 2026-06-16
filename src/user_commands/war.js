const { SlashCommandBuilder, InteractionContextType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');

const { Colors, formatBalance, buildAuthor, handleInteractionError } = require('../utils/standards.js');
const { createInsufficientMoneyEmbed, createTimedOutEmbed, createIlligalInteractionEmbed } = require('../utils/standard_embeds.js');

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const SHOT_PRICE = 1;
const MIN_SHOTS = 4;
const MAX_SHOTS = 20;
const TIME_LIMIT_MS = 3 * 60 * 1000; // 3 minutes

const SHIPS = [
    { name: 'Carrier', length: 5, emoji: '🚢' },
    { name: 'Cruiser', length: 3, emoji: '🛥️' },
    { name: 'Destroyer', length: 2, emoji: '🚤' }
];

function randInt(max) { return Math.floor(Math.random() * max); }

function placeShips() {
    // returns array of ship objects with coords (indices)
    const occupied = new Set();
    const placed = [];

    for (const def of SHIPS) {
        let tries = 0;
        while (tries < 1000) {
            tries++;
            const horizontal = Math.random() < 0.5;
            const row = randInt(GRID_SIZE);
            const col = randInt(GRID_SIZE);
            const coords = [];

            for (let k = 0; k < def.length; k++) {
                const r = row + (horizontal ? 0 : k);
                const c = col + (horizontal ? k : 0);
                if (r >= GRID_SIZE || c >= GRID_SIZE) {
                    coords.length = 0; break;
                }
                coords.push(r * GRID_SIZE + c);
            }

            if (coords.length === 0) continue;

            // check overlap
            let ok = true;
            for (const idx of coords) if (occupied.has(idx)) { ok = false; break; }
            if (!ok) continue;

            // place
            for (const idx of coords) occupied.add(idx);
            placed.push({ name: def.name, length: def.length, coords, hits: 0, sunk: false, emoji: def.emoji });
            break;
        }
    }

    return placed;
}

function generateBoardComponents(ships, revealed, gameOver) {
    const rows = [];
    for (let r = 0; r < GRID_SIZE; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < GRID_SIZE; c++) {
            const idx = r * GRID_SIZE + c;
            const wasShot = revealed[idx];
            const ship = ships.find(s => s.coords.includes(idx));
            let emoji = '❓';
            let style = ButtonStyle.Secondary;
            let disabled = false;

            if (wasShot) {
                disabled = true;
                emoji = ship ? ship.emoji : '🌊';
                style = ButtonStyle.Danger;
            } else if (gameOver) {
                disabled = true;
                if (ship) {
                    emoji = ship.emoji;
                    style = ButtonStyle.Primary;
                } else {
                    emoji = '🌊';
                    style = ButtonStyle.Secondary;
                }
            }

            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`war_${idx}`)
                    .setEmoji(emoji)
                    .setStyle(style)
                    .setDisabled(disabled)
            );
        }
        rows.push(row);
    }

    return rows;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('war')
        .setDescription('Play a battleship-style game.')
        .addNumberOption((option) => option
            .setName('shots')
            .setDescription('Number of shots to buy. Each shot costs $50.')
            .setRequired(true)
            .setMinValue(MIN_SHOTS)
            .setMaxValue(MAX_SHOTS)
        )
        .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

    async execute(interaction) {
        const shots = interaction.options.getNumber('shots');
        const stake = shots * SHOT_PRICE;
        const userId = interaction.user.id;
        const db = interaction.client.db;

        try {
            const profile = await db.ensureUser(userId);
            if (profile.balance < stake) {
                return await interaction.reply({ embeds: [await createInsufficientMoneyEmbed(interaction, stake)], flags: MessageFlags.Ephemeral });
            }

            // Prepare game state
            const ships = placeShips();
            const revealed = Array(CELL_COUNT).fill(false);
            let shotsLeft = shots;
            let totalPayout = 0; // gross win amount
            const shipPayouts = {}; // map name -> payout (gross)

            // Define payouts as multipliers of stake (tuned for approx RTP)
            shipPayouts['Carrier'] = stake * 3.0;
            shipPayouts['Cruiser'] = stake * 1.5;
            shipPayouts['Destroyer'] = stake * 0.8;

            const embed = new EmbedBuilder()
                .setAuthor(buildAuthor(interaction))
                .setTitle(':crossed_swords: War In Progress')
                .setDescription(`Enemy ships leave <t:${Math.floor(Date.now()/1000 + TIME_LIMIT_MS/1000)}:R>. Sink them before then!`)
                .addFields(
                    { name: 'Shots Left', value: `:gun: ${shotsLeft}`, inline: true },
                    { name: 'Ships', value: ships.map(s => `> ${s.sunk ? ':x:' : ':white_check_mark:'} **${s.name}**`).join('\n'), inline: true },
                    { name: 'Profit', value: `**${formatBalance(-stake, true)}**`, inline: true }
                )
                .setColor(Colors.YELLOW)
                .setTimestamp()
                .setFooter({ text: 'Gamble Bot' });

            await interaction.reply({ embeds: [embed], components: generateBoardComponents(ships, revealed, false) });
            const response = await interaction.fetchReply();

            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: TIME_LIMIT_MS });

            collector.on('collect', async (i) => {
                if (i.user.id !== userId) return i.reply({ embeds: [createIlligalInteractionEmbed()], flags: MessageFlags.Ephemeral });

                // Prevent clicking when no shots left
                if (shotsLeft <= 0) return i.reply({ content: 'No shots left.', flags: MessageFlags.Ephemeral });

                const idx = parseInt(i.customId.split('_')[1]);
                if (isNaN(idx) || idx < 0 || idx >= CELL_COUNT) return i.reply({ content: 'Invalid cell.', flags: MessageFlags.Ephemeral });
                if (revealed[idx]) return i.reply({ content: 'Already shot there.', flags: MessageFlags.Ephemeral });

                // Reveal cell
                revealed[idx] = true;
                shotsLeft--;

                // Check hit
                const hitShip = ships.find(s => s.coords.includes(idx));
                let newlySunk = null;
                if (hitShip) {
                    hitShip.hits++;
                    if (hitShip.hits >= hitShip.length && !hitShip.sunk) {
                        hitShip.sunk = true;
                        newlySunk = hitShip.name;
                        // award payout for sunk ship
                        totalPayout += shipPayouts[hitShip.name] || 0;
                    }
                }

                // Update embed fields
                embed.setFields(
                    { name: 'Shots Left', value: `:gun: ${shotsLeft}`, inline: true },
                    { name: 'Ships', value: ships.map(s => `> ${s.sunk ? ':x:' : ':white_check_mark:'} **${s.name}**`).join('\n'), inline: true },
                    { name: 'Profit', value: `**${formatBalance(totalPayout - stake, true)}**`, inline: true }
                );

                const components = generateBoardComponents(ships, revealed, false);
                await i.update({ embeds: [embed], components }).catch(console.error);

                // End early if no shots left
                if (shotsLeft <= 0) {
                    collector.stop('finished');
                }
            });

            collector.on('end', async (_, reason) => {
                // Determine final ships sunk and shots fired
                const shipsSunk = ships.filter(s => s.sunk).length;
                const shotsFired = shots - shotsLeft;

                // Record game play
                const updatedProfile = await db.recordGamePlay(userId, stake, totalPayout);
                await db.setWarStats(userId, shipsSunk, shotsFired);

                // Build final embed
                const profit = totalPayout - stake;
                const title = ':crossed_swords: War Results';
                const description = profit >= 0 ? ':trophy: You made a profit!' : ':x: You lost money this round.';
                const color = profit >= 0 ? Colors.GREEN : Colors.RED;

                embed.setTitle(title)
                    .setDescription(description)
                    .setColor(color)
                    .setFields(
                        { name: 'Stake', value: formatBalance(stake), inline: true },
                        { name: 'Profit', value: formatBalance(profit, true), inline: true },
                        { name: 'Ships Sunk', value: `${shipsSunk}`, inline: true },
                        { name: 'New Balance', value: `:moneybag: **${formatBalance(updatedProfile.balance)}**`, inline: false }
                    )
                    .setTimestamp();

                const finalComponents = generateBoardComponents(ships, revealed, true);

                if (reason === 'time') {
                    // User timed out - show timed out embed then reveal board
                    const timeoutEmbed = createTimedOutEmbed(interaction);
                    timeoutEmbed.setDescription(':hourglass: The enemy left - remaining shots are lost.');
                    await interaction.editReply({ embeds: [timeoutEmbed], components: finalComponents }).catch(console.error);

                    // Follow up with results after a short delay
                    await interaction.followUp({ embeds: [embed], components: [] }).catch(console.error);
                    return;
                }

                await interaction.editReply({ embeds: [embed], components: finalComponents }).catch(console.error);
            });

        } catch (error) {
            handleInteractionError(interaction, error);
        }
    }
};
