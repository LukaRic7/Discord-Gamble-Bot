const { Routes, REST } = require('discord.js');
const fs = require('node:fs');
const path = require('path');

// Grab all command files
const commandsPath = path.join(__dirname, '../user_commands');
const commandFiles = fs.readdirSync(commandsPath);

/**
 * Utility class for deploying Discord slash commands.
 */
class CommandDeployer {
    /**
     * Deploys or unloads slash commands globally for the application.
     * @param {boolean} [unload=false] - Whether to remove commands instead of deploying them.
     * @returns {Promise<void>}
     */
    static async deploySlashCommandsGlobally(unload=false) {
        let commands = [];

        // Load command data from files if not in unload mode
        if (!unload) {    
            for (const file of commandFiles) {
                const command = require(path.join(commandsPath, file));
                commands.push(command.data.toJSON());
            }
        }

        const token = process.env.DISCORD_TOKEN;
        const applicationId = process.env.APPLICATION_ID;
        if (!token) {
            throw new Error('Missing DISCORD_TOKEN environment variable.');
        }
        if (!applicationId) {
            throw new Error('Missing APPLICATION_ID environment variable.');
        }

        // Create the REST instance
        const rest = new REST({ version: '10' }).setToken(token);

        // Deploy the commands, logging success and catching a potential error
        try {
            await rest.put(
                Routes.applicationCommands(applicationId),
                { body: commands }
            );

            console.log(`[Discord] Reloaded ${commands.length} slash command successfully!`);
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = CommandDeployer;