const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Service = require('./models/Service');
  
// Mock external dependencies
jest.mock('axios');
const axios = require('axios');
  
const mockFiveSimData = require('./__mocks__/5sim_prices.json');
const mockSmsActivateCountries = require('./__mocks__/sms_countries.json');
const mockSmsActivateServices = require('./__mocks__/sms_services.json');
const mockSmsActivatePrices = require('./__mocks__/sms_prices.json');
  
let mongod;
  
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});
  
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});
  
afterEach(async () => {
    await Service.deleteMany({});
    jest.clearAllMocks();
});
  
  
describe('Service Update Script', () => {
  
    function runScript() {
        return require('./updateServices');
    }
  
    it('should handle unknown service codes gracefully', async () => {
        axios.get.mockImplementation((url, config) => {
            if (url.includes('5sim')) return Promise.resolve({ data: {} });
            if (config.params.action === 'getCountries') return Promise.resolve({ data: mockSmsActivateCountries });
            if (config.params.action === 'getServicesList') return Promise.resolve({ data: { status: 'success', services: [] } }); // No services in list
            if (config.params.action === 'getPrices') return Promise.resolve({ data: { '0': { 'unknown_service': { cost: '10', count: '5' } } } }); // Unknown service in prices
            return Promise.resolve({ data: {} });
        });
  
        // We need to un-cache the module to re-run it
        jest.isolateModules(async () => {
            await runScript();
        });
          
        // Await for async operations inside the script to complete
        await new Promise(process.nextTick);
  
        const service = await Service.findOne({ service: 'unknown_service' }).lean();
        expect(service).not.toBeNull();
        expect(service.service_persian).toBe('Unknown-unknown_service');
    });
  
    it('should perform an idempotent upsert', async () => {
        const initialService = {
            id: 'srv_telegram_russia_any_5sim',
            service: 'telegram',
            service_persian: 'تلگرام',
            country: 'russia',
            country_persian: 'روسیه',
            country_code: 'RU',
            operator: 'any',
            price_toman: 1000,
            priority: 1,
            available: true,
            success_rate: 95,
            provider: '5sim',
        };
        await new Service(initialService).save();
  
        axios.get.mockImplementation((url, config) => {
            if (url.includes('5sim')) return Promise.resolve({ data: { russia: { telegram: { any: { cost: 10, count: 100, rate: 98 } } } } });
            if (config?.params?.action === 'getCountries') return Promise.resolve({ data: mockSmsActivateCountries });
            if (config?.params?.action === 'getServicesList') return Promise.resolve({ data: mockSmsActivateServices });
            if (config?.params?.action === 'getPrices') return Promise.resolve({ data: {} });
            return Promise.resolve({ data: {} });
        });
  
        jest.isolateModules(async () => {
            await runScript();
        });
  
        await new Promise(process.nextTick);
  
        const services = await Service.find({}).lean();
        expect(services).toHaveLength(1);
        expect(services[0].success_rate).toBe(98); // Check that it was updated
        expect(services[0].price_toman).not.toBe(1000);
    });
  
     it('should handle API errors with retry', async () => {
        let callCount = 0;
        axios.get.mockImplementation((url, config) => {
            if (url.includes('5sim')) {
                callCount++;
                if (callCount < 3) {
                    return Promise.reject({ response: { status: 500 } });
                }
                return Promise.resolve({ data: mockFiveSimData });
            }
            // Mock successful responses for other calls
            if (config?.params?.action === 'getCountries') return Promise.resolve({ data: mockSmsActivateCountries });
            if (config?.params?.action === 'getServicesList') return Promise.resolve({ data: mockSmsActivateServices });
            if (config?.params?.action === 'getPrices') return Promise.resolve({ data: mockSmsActivatePrices });
            return Promise.resolve({ data: {} });
        });
  
        jest.isolateModules(async () => {
            await runScript();
        });
  
        await new Promise(resolve => setTimeout(resolve, 500)); // allow script to run
  
        expect(callCount).toBe(3);
        const serviceCount = await Service.countDocuments();
        expect(serviceCount).toBeGreaterThan(0);
    });
});
