import { DiscordController } from '../DiscordController.js';
import { ConfigManager } from '../ConfigManager.js';

// Mock the DiscordService and AutomationManager
jest.mock('../../discord-service.js');
jest.mock('../AutomationManager.js');

describe('DiscordController', () => {
  let discordController: DiscordController;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Initialize singletons
    configManager = ConfigManager.getInstance();
    
    // Create controller
    discordController = new DiscordController();
  });

  describe('initialization', () => {
    it('should create controller instance', () => {
      expect(discordController).toBeDefined();
      expect(discordController.getConfigManager()).toBe(configManager);
    });
  });

  describe('configuration', () => {
    it('should load configuration from environment', () => {
      const config = configManager.getConfig();
      expect(config).toBeDefined();
    });

    it('should include OAuth configuration', () => {
      const config = configManager.getConfig();
      expect(config.oauth).toBeDefined();
    });
  });
});
