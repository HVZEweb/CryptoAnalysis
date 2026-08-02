/**
 * Инициализация таблиц для Spread Bot
 * Запуск: npx tsx scripts/init-spread-db.ts
 */

import { execute, query } from "@/lib/db";

async function initSpreadTables() {
  console.log("🔧 Создание таблиц для Spread Bot...\n");

  // Таблица настроек бота
  await execute(`
    CREATE TABLE IF NOT EXISTS spread_bot_configs (
      id CHAR(24) PRIMARY KEY,
      user_id CHAR(24) NOT NULL,
      name VARCHAR(100) NOT NULL,
      exchange VARCHAR(20) NOT NULL DEFAULT 'okx',
      trading_pair VARCHAR(20) NOT NULL,
      market_type ENUM('spot', 'futures') NOT NULL DEFAULT 'spot',
      
      -- Параметры спреда
      min_density DECIMAL(12,2) NOT NULL DEFAULT 1000.00,
      min_spread_pct DECIMAL(5,2) NOT NULL DEFAULT 0.10,
      max_spread_pct DECIMAL(5,2) NOT NULL DEFAULT 1.00,
      update_interval_ms INT NOT NULL DEFAULT 1000,
      
      -- Риск-менеджмент
      max_position_size DECIMAL(12,8) NOT NULL,
      max_positions INT NOT NULL DEFAULT 3,
      stop_loss_pct DECIMAL(5,2) DEFAULT NULL,
      take_profit_pct DECIMAL(5,2) DEFAULT NULL,
      
      -- Состояние
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      balance_allocated DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      INDEX idx_user_id (user_id),
      INDEX idx_active (is_active),
      CONSTRAINT fk_spread_config_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("✅ Таблица spread_bot_configs создана");

  // Таблица истории ордеров
  await execute(`
    CREATE TABLE IF NOT EXISTS spread_orders (
      id CHAR(24) PRIMARY KEY,
      config_id CHAR(24) NOT NULL,
      user_id CHAR(24) NOT NULL,
      
      order_id VARCHAR(100) NOT NULL,
      exchange VARCHAR(20) NOT NULL,
      trading_pair VARCHAR(20) NOT NULL,
      
      side ENUM('buy', 'sell') NOT NULL,
      order_type ENUM('limit', 'market') NOT NULL,
      
      price DECIMAL(24,12) NOT NULL,
      size DECIMAL(24,12) NOT NULL,
      filled_size DECIMAL(24,12) NOT NULL DEFAULT 0,
      
      status ENUM('pending', 'filled', 'cancelled', 'failed') NOT NULL,
      
      profit_loss DECIMAL(12,8) DEFAULT NULL,
      fees DECIMAL(12,8) DEFAULT NULL,
      
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      filled_at TIMESTAMP NULL,
      
      INDEX idx_config_id (config_id),
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_created (created_at),
      CONSTRAINT fk_spread_order_config FOREIGN KEY (config_id) REFERENCES spread_bot_configs(id) ON DELETE CASCADE,
      CONSTRAINT fk_spread_order_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("✅ Таблица spread_orders создана");

  // Таблица статистики по сессиям
  await execute(`
    CREATE TABLE IF NOT EXISTS spread_sessions (
      id CHAR(24) PRIMARY KEY,
      config_id CHAR(24) NOT NULL,
      user_id CHAR(24) NOT NULL,
      
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      stopped_at TIMESTAMP NULL,
      
      total_orders INT NOT NULL DEFAULT 0,
      filled_orders INT NOT NULL DEFAULT 0,
      
      total_profit DECIMAL(12,8) NOT NULL DEFAULT 0,
      total_fees DECIMAL(12,8) NOT NULL DEFAULT 0,
      net_profit DECIMAL(12,8) NOT NULL DEFAULT 0,
      
      win_rate DECIMAL(5,2) DEFAULT NULL,
      avg_profit_per_trade DECIMAL(12,8) DEFAULT NULL,
      
      INDEX idx_config_id (config_id),
      INDEX idx_user_id (user_id),
      INDEX idx_started (started_at),
      CONSTRAINT fk_spread_session_config FOREIGN KEY (config_id) REFERENCES spread_bot_configs(id) ON DELETE CASCADE,
      CONSTRAINT fk_spread_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log("✅ Таблица spread_sessions создана");

  console.log("\n✅ Все таблицы для Spread Bot успешно созданы!\n");

  // Проверка существующих таблиц
  const tables = await query<Array<{ TABLE_NAME: string }>>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'spread_%'",
    [process.env.DB_NAME ?? "crypto_predictor"]
  );

  console.log("📋 Таблицы Spread Bot:");
  tables.forEach((t) => console.log(`  - ${t.TABLE_NAME}`));
}

initSpreadTables().catch((err) => {
  console.error("❌ Ошибка инициализации:", err);
  process.exit(1);
});
