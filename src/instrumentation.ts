export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      console.log('Running database migrations...');
      await import('./lib/db/migrate');
      console.log('Database migrations completed successfully');
    } catch (error) {
      console.error('Failed to run database migrations:', error);
    }

    await import('./lib/config/index');

    // Seed MCP servers from config.json to DB on first run
    try {
      const { seedMcpServersFromConfig } = await import('./lib/db/mcpServers');
      await seedMcpServersFromConfig();
    } catch (error) {
      console.error('Failed to seed MCP servers to database:', error);
    }
  }
};
