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

    // Seed provider connections from config.json to DB on first run
    try {
      const { seedModelProvidersFromConfig } = await import(
        './lib/db/modelProviders'
      );
      await seedModelProvidersFromConfig();
    } catch (error) {
      console.error('Failed to seed provider connections to database:', error);
    }

    // Ensure AUTH_SECRET is available for WebAuthn sessions
    try {
      const { ensureAuthSecret } = await import('./lib/auth/session');
      await ensureAuthSecret();
    } catch (error) {
      console.error('Failed to initialize auth secret:', error);
    }
  }
};
