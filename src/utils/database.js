const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

/**
 * Manager class for communicating with the database.
 */
class DatabaseManager {
    /**
     * Create a new DatabaseManager instance.
     * @param {string} dbFilePath - Path to the SQLite database file.
     */
    constructor(dbFilePath) {
        this.dbFilePath = dbFilePath;
        this.db = null;
    }

    // ==========================================
    // INITIALIZATION & SETUP
    // ==========================================

    /**
     * Initialize the database by opening a connection and enabling foreign keys.
     * @returns {Promise<void>}
     */
    async init() {
        this.db = await open({
            filename: this.dbFilePath,
            driver: sqlite3.Database
        });
    
        await this.db.exec('PRAGMA foreign_keys = ON;');
    
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS player_profiles (
                user_id            VARCHAR (25) PRIMARY KEY,
                balance            BIGINT       DEFAULT 0,
                total_waged        BIGINT       DEFAULT 0,
                lifetime_profit    BIGINT       DEFAULT 0,
                daily_streak       INT          DEFAULT 0,
                last_daily_claim   TIMESTAMP    NULL,
                total_games_played INT          DEFAULT 0,
                created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                total_payed        BIGINT       DEFAULT 0,
                total_received     BIGINT       DEFAULT 0
            );
    
            CREATE TABLE IF NOT EXISTS game_slots (
                user_id            VARCHAR (25) PRIMARY KEY,
                jackpots_hit       INT          DEFAULT 0,
                current_win_streak INT          DEFAULT 0,
                longest_win_streak INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_mines (
                user_id       VARCHAR (25) PRIMARY KEY,
                bombs_hit     INT          DEFAULT 0,
                diamonds_hit  INT          DEFAULT 0,
                perfect_games INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_highlow (
                user_id        VARCHAR (25) PRIMARY KEY,
                longest_streak INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_crash (
                user_id            VARCHAR (25) PRIMARY KEY,
                highest_multiplier DECIMAL (10, 2) DEFAULT 0.0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_coinflip (
                user_id            VARCHAR (25) PRIMARY KEY,
                longest_win_streak INT          DEFAULT 0,
                current_win_streak INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_chests (
                user_id            VARCHAR (25) PRIMARY KEY,
                total_opened       INT          DEFAULT 0,
                current_win_streak INT          DEFAULT 0,
                longest_win_streak INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
    
            CREATE TABLE IF NOT EXISTS game_blackjack (
                user_id            VARCHAR (25) PRIMARY KEY,
                total_hands        INT          DEFAULT 0,
                natural_blackjacks INT          DEFAULT 0,
                current_win_streak INT          DEFAULT 0,
                longest_win_streak INT          DEFAULT 0,
                FOREIGN KEY (user_id)
                    REFERENCES player_profiles (user_id)
                    ON DELETE CASCADE
            );
        `);
    
        console.log(`[Database] Connected at: "${this.dbFilePath}"`);
    }

    // ==========================================
    // CORE PROFILE & ECONOMY
    // ==========================================

    /**
     * Retrieves a user profile row by Discord user ID.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object|null>} The profile row, or null if none exists.
     */
    async getUser(userId) {
        return await this.db.get(`SELECT * FROM player_profiles WHERE user_id = ?`, [userId]);
    }

    /**
     * Ensures a user exists in the player_profiles table. If not, inserts a default profile.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object|null>} The user profile row.
     */
    async ensureUser(userId) {
        await this.db.run(`
            INSERT INTO player_profiles (user_id, balance)
            VALUES (?, 500)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);
    
        return await this.getUser(userId);
    }

    /**
     * Records a game play event and updates the user's economy statistics.
     * @param {string} userId - The Discord user ID.
     * @param {number} betAmount - The amount the user wagered.
     * @param {number} winAmount - The payout amount received.
     * @returns {Promise<Object>} The updated user profile row.
     */
    async recordGamePlay(userId, betAmount, winAmount) {
        await this.ensureUser(userId);
        const netProfit = winAmount - betAmount;
        
        await this.db.run(`
            UPDATE player_profiles 
            SET 
                balance = balance + ?,
                total_waged = total_waged + ?,
                lifetime_profit = lifetime_profit + ?,
                total_games_played = total_games_played + 1
            WHERE user_id = ?
        `, [netProfit, betAmount, netProfit, userId]);

        return await this.getUser(userId);
    }

    /**
     * Retrieves the daily reward metadata for a user.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The user's daily streak and last claim timestamp.
     */
    async getDailyData(userId) {
        await this.ensureUser(userId);
    
        return await this.db.get(
            `SELECT daily_streak, last_daily_claim FROM player_profiles WHERE user_id = ?`,
            [userId]
        );
    }

    /**
     * Claims the daily reward and updates streak and balance information.
     * @param {string} userId - The Discord user ID.
     * @param {number} reward - The amount to credit.
     * @param {number} newStreak - The updated daily streak count.
     * @returns {Promise<Object>} The updated user profile row.
     */
    async claimDaily(userId, reward, newStreak) {
        await this.ensureUser(userId);
    
        await this.db.run(
            `UPDATE player_profiles
             SET 
                last_daily_claim = CURRENT_TIMESTAMP,
                balance = balance + ?,
                daily_streak = ?
             WHERE user_id = ?`,
            [reward, newStreak, userId]
        );
    
        return await this.getUser(userId);
    }

    /**
     * Transfers money from one user to another and updates transfer statistics.
     * @param {string} senderId - The Discord ID of the sender.
     * @param {string} recipientId - The Discord ID of the recipient.
     * @param {number} amount - The amount to transfer.
     * @returns {Promise<Array<Object>>} The updated sender and recipient profiles.
     */
    async transferMoney(senderId, recipientId, amount) {
        await this.ensureUser(senderId);
        await this.ensureUser(recipientId);

        await this.db.run(`
            UPDATE player_profiles
            SET
                balance = balance - ?,
                total_payed = total_payed + ?
            WHERE user_id = ?
        `, [amount, amount, senderId]);

        await this.db.run(`
            UPDATE player_profiles
            SET
                balance = balance + ?,
                total_received = total_received + ?
            WHERE user_id = ?
        `, [amount, amount, recipientId]);

        return [await this.getUser(senderId), await this.getUser(recipientId)];
    }
    
    /**
     * Retrieves combined profile and game statistics for a user.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} Combined profile and per-game statistic columns.
     */
    async getAllStats(userId) {
        const query = `
            SELECT 
                p.*,
                b.total_hands AS bj_total_hands, b.natural_blackjacks AS bj_natural_blackjacks, b.longest_win_streak AS bj_longest_win_streak,
                c.total_opened AS chests_total_opened, c.longest_win_streak AS chests_longest_win_streak,
                cf.longest_win_streak AS coinflip_longest_win_streak,
                cr.highest_multiplier AS crash_highest_multiplier,
                hl.longest_streak AS highlow_longest_streak,
                m.bombs_hit AS mines_bombs_hit, m.diamonds_hit AS mines_diamonds_hit, m.perfect_games AS mines_perfect_games,
                s.jackpots_hit AS slots_jackpots_hit, s.longest_win_streak AS slots_longest_win_streak
            FROM player_profiles p
            LEFT JOIN game_blackjack b ON p.user_id = b.user_id
            LEFT JOIN game_chests c ON p.user_id = c.user_id
            LEFT JOIN game_coinflip cf ON p.user_id = cf.user_id
            LEFT JOIN game_crash cr ON p.user_id = cr.user_id
            LEFT JOIN game_highlow hl ON p.user_id = hl.user_id
            LEFT JOIN game_mines m ON p.user_id = m.user_id
            LEFT JOIN game_slots s ON p.user_id = s.user_id
            WHERE p.user_id = ?
        `;
    
        // Execute the query. (e.g., if using sqlite)
        // Replace this execution line with your actual DB query execution syntax
        const row = await this.db.get(query, [userId]); 
        
        return row;
    }

    // ==========================================
    // GAME: SLOTS
    // ==========================================

    /**
     * Ensures a row exists for the user's slot statistics and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The slot stats row.
     */
    async getSlotsStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_slots (user_id, jackpots_hit, current_win_streak, longest_win_streak)
            VALUES (?, 0, 0, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_slots WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's slot statistics.
     * @param {string} userId - The Discord user ID.
     * @param {number} currentWinStreak - The current win streak for slots.
     * @param {number} jackpotHit - The number of jackpots hit in this update.
     * @returns {Promise<void>}
     */
    async setSlotsStats(userId, currentWinStreak, jackpotHit) {
        await this.db.run(`
            INSERT INTO game_slots (user_id, jackpots_hit, current_win_streak, longest_win_streak)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE
            SET
                current_win_streak = EXCLUDED.current_win_streak,
                longest_win_streak = MAX(game_slots.longest_win_streak, EXCLUDED.longest_win_streak),
                jackpots_hit = jackpots_hit + EXCLUDED.jackpots_hit
        `, [userId, jackpotHit, currentWinStreak, currentWinStreak])
    }

    // ==========================================
    // GAME: CRASH
    // ==========================================

    /**
     * Ensures a crash stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The crash stats row.
     */
    async getCrashStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_crash (user_id, highest_multiplier)
            VALUES (?, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_crash WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's highest crash multiplier.
     * @param {string} userId - The Discord user ID.
     * @param {number} highestMultiplier - The latest crash multiplier to compare.
     * @returns {Promise<void>}
     */
    async setCrashStats(userId, highestMultiplier) {
        await this.db.run(`
            INSERT INTO game_crash (user_id, highest_multiplier)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE
            SET
                highest_multiplier = MAX(game_crash.highest_multiplier, EXCLUDED.highest_multiplier)
        `, [userId, highestMultiplier]);
    }

    // ==========================================
    // GAME: MINES
    // ==========================================

    /**
     * Ensures a mines stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The mines stats row.
     */
    async getMinesStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_mines (user_id, bombs_hit, diamonds_hit, perfect_games)
            VALUES (?, 0, 0, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_mines WHERE user_id = ?`, [userId]);
    }

    /**
     * Increments mines statistics for the user.
     * @param {string} userId - The Discord user ID.
     * @param {number} addBombs - Number of bombs hit to add.
     * @param {number} addDiamonds - Number of diamonds found to add.
     * @param {number} addPerfect - Number of perfect games to add.
     * @returns {Promise<void>}
     */
    async setMinesStats(userId, addBombs, addDiamonds, addPerfect) {
        await this.db.run(`
            INSERT INTO game_mines (user_id, bombs_hit, diamonds_hit, perfect_games)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE
            SET
                bombs_hit = bombs_hit + ${addBombs},
                diamonds_hit = diamonds_hit + ${addDiamonds},
                perfect_games = perfect_games + ${addPerfect}
        `, [userId, addBombs, addDiamonds, addPerfect]);
    }

    // ==========================================
    // GAME: COINFLIP
    // ==========================================

    /**
     * Ensures a coinflip stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The coinflip stats row.
     */
    async getCoinflipStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_coinflip (user_id, current_win_streak, longest_win_streak) 
            VALUES (?, 0, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_coinflip WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's coinflip streak statistics.
     * @param {string} userId - The Discord user ID.
     * @param {number} streak - The user's current coinflip win streak.
     * @returns {Promise<void>}
     */
    async setCoinflipStats(userId, streak) {
        await this.db.run(`
            INSERT INTO game_coinflip (user_id, current_win_streak, longest_win_streak) 
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE 
            SET 
                current_win_streak = EXCLUDED.current_win_streak,
                longest_win_streak = MAX(game_coinflip.longest_win_streak, EXCLUDED.longest_win_streak)
        `, [userId, streak, streak]);
    }
    
    // ==========================================
    // GAME: HIGHLOW
    // ==========================================

    /**
     * Ensures a highlow stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The highlow stats row.
     */
    async getHighlowStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_highlow (user_id, longest_streak)
            VALUES (?, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_highlow WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's highlow longest streak value.
     * @param {string} userId - The Discord user ID.
     * @param {number} streak - The latest highlow streak to compare.
     * @returns {Promise<void>}
     */
    async setHighlowStats(userId, streak) {
        await this.db.run(`
            INSERT INTO game_highlow (user_id, longest_streak)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE
                SET longest_streak = MAX(game_highlow.longest_streak, EXCLUDED.longest_streak)
        `, [userId, streak]);
    }

    // ==========================================
    // GAME: BLACKJACK
    // ==========================================

    /**
     * Ensures a blackjack stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The blackjack stats row.
     */
    async getBlackjackStats(userId) {
        await this.ensureUser(userId);
        await this.db.run(`
            INSERT INTO game_blackjack (user_id, total_hands, natural_blackjacks, current_win_streak, longest_win_streak)
            VALUES (?, 0, 0, 0, 0) ON CONFLICT(user_id) DO NOTHING
        `, [userId]);
        return await this.db.get(`SELECT * FROM game_blackjack WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's blackjack performance statistics.
     * @param {string} userId - The Discord user ID.
     * @param {boolean} isNatural - Whether the hand was a natural blackjack.
     * @param {boolean} wonHand - Whether the hand was won.
     * @param {number} newStreak - The current blackjack win streak.
     * @returns {Promise<void>}
     */
    async updateBlackjackStats(userId, isNatural, wonHand, newStreak) {
        const naturalCount = isNatural ? 1 : 0;
        await this.db.run(`
            INSERT INTO game_blackjack (user_id, total_hands, natural_blackjacks, current_win_streak, longest_win_streak)
            VALUES (?, 1, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE 
            SET 
                total_hands = total_hands + 1,
                natural_blackjacks = natural_blackjacks + EXCLUDED.natural_blackjacks,
                current_win_streak = EXCLUDED.current_win_streak,
                longest_win_streak = MAX(game_blackjack.longest_win_streak, EXCLUDED.longest_win_streak)
        `, [userId, naturalCount, newStreak, newStreak]);
    }

    // ==========================================
    // GAME: CHESTS
    // ==========================================

    /**
     * Ensures a chests stats row exists for the user and returns it.
     * @param {string} userId - The Discord user ID.
     * @returns {Promise<Object>} The chests stats row.
     */
    async getChestsStats(userId) {
        await this.ensureUser(userId);

        await this.db.run(`
            INSERT INTO game_chests (user_id, total_opened, current_win_streak, longest_win_streak) 
            VALUES (?, 0, 0, 0)
            ON CONFLICT(user_id) DO NOTHING
        `, [userId]);

        return await this.db.get(`SELECT * FROM game_chests WHERE user_id = ?`, [userId]);
    }

    /**
     * Updates the user's chest opening streak and count.
     * @param {string} userId - The Discord user ID.
     * @param {number} newStreak - The current chest win streak.
     * @returns {Promise<void>}
     */
    async updateChestsStats(userId, newStreak) {
        await this.db.run(`
            INSERT INTO game_chests (user_id, total_opened, current_win_streak, longest_win_streak) 
            VALUES (?, 1, ?, ?)
            ON CONFLICT(user_id) DO UPDATE 
            SET 
                total_opened = total_opened + 1,
                current_win_streak = EXCLUDED.current_win_streak,
                longest_win_streak = MAX(game_chests.longest_win_streak, EXCLUDED.longest_win_streak)
        `, [userId, newStreak, newStreak]);
    }
}

module.exports = DatabaseManager;