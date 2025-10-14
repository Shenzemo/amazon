const { convertToToman } = require('./priceConverter');

describe('priceConverter', () => {
   it('should correctly convert RUB to Toman with profit margin and rounding', () => {
       const rates = { rub: 150 };
       const price = 10; // RUB
       const expected = 2100;
       expect(convertToToman(price, 'RUB', rates)).toBe(expected);
   });

   it('should correctly convert USD to Toman with profit margin and rounding', () => {
       const rates = { usd: 50000 };
       const price = 1; // USD
       const expected = 70000;
       expect(convertToToman(price, 'USD', rates)).toBe(expected);
   });
});