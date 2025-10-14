// setup-indexes.js
// اسکریپت برای ایجاد index های بهینه برای lazy loading

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

const setupIndexes = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const servicesCollection = db.collection('services');

    console.log('\n📊 Creating indexes for optimal lazy loading performance...\n');

    // Index 1: برای فیلتر کردن featured services
    console.log('1️⃣  Creating index for featured services (priority)...');
    await servicesCollection.createIndex(
      { priority: 1, available: 1 },
      { name: 'priority_available_idx', background: true }
    );
    console.log('   ✅ Index created: priority_available_idx');

    // Index 2: برای جستجوی بر اساس نام فارسی سرویس
    console.log('2️⃣  Creating index for Persian service names...');
    await servicesCollection.createIndex(
      { service_persian: 1 },
      { name: 'service_persian_idx', background: true }
    );
    console.log('   ✅ Index created: service_persian_idx');

    // Index 3: برای جستجوی بر اساس نام انگلیسی سرویس
    console.log('3️⃣  Creating index for English service names...');
    await servicesCollection.createIndex(
      { service: 1 },
      { name: 'service_idx', background: true }
    );
    console.log('   ✅ Index created: service_idx');

    // Index 4: Compound index برای فیلتر سریع‌تر
    console.log('4️⃣  Creating compound index for fast filtering...');
    await servicesCollection.createIndex(
      { service_persian: 1, country_persian: 1, available: 1 },
      { name: 'service_country_available_idx', background: true }
    );
    console.log('   ✅ Index created: service_country_available_idx');

    // Index 5: برای ID lookup سریع
    console.log('5️⃣  Creating index for service ID lookup...');
    try {
      await servicesCollection.createIndex(
        { id: 1 },
        { name: 'service_id_idx', unique: true, background: true }
      );
      console.log('   ✅ Index created: service_id_idx');
    } catch (err) {
      if (err.code === 85 || err.codeName === 'IndexOptionsConflict') {
        console.log('   ⚠️  Index already exists with name "id_1" (using existing index)');
      } else {
        throw err;
      }
    }

    console.log('\n🎉 All indexes created successfully!\n');

    // نمایش لیست تمام index ها
    console.log('📋 Current indexes on services collection:');
    const indexes = await servicesCollection.indexes();
    indexes.forEach((index, i) => {
      console.log(`   ${i + 1}. ${index.name}`);
      console.log(`      Keys: ${JSON.stringify(index.key)}`);
      if (index.unique) console.log(`      Unique: true`);
      console.log('');
    });

    // آمار collection
    const stats = await servicesCollection.stats();
    console.log('📊 Collection Statistics:');
    console.log(`   Total documents: ${stats.count.toLocaleString()}`);
    console.log(`   Average document size: ${Math.round(stats.avgObjSize)} bytes`);
    console.log(`   Total index size: ${Math.round(stats.totalIndexSize / 1024 / 1024)} MB`);
    console.log(`   Storage size: ${Math.round(stats.storageSize / 1024 / 1024)} MB\n`);

    // تست performance
    console.log('🧪 Testing index performance...\n');

    // Test 1: Featured services query
    console.log('Test 1: Featured services query');
    const start1 = Date.now();
    const featured = await servicesCollection.find({ priority: { $lt: 50 } }).explain('executionStats');
    const end1 = Date.now();
    console.log(`   Execution time: ${end1 - start1}ms`);
    console.log(`   Documents examined: ${featured.executionStats.totalDocsExamined}`);
    console.log(`   Documents returned: ${featured.executionStats.nReturned}`);
    console.log(`   Index used: ${featured.executionStats.executionStages.indexName || 'COLLSCAN'}`);

    // Test 2: Service-specific query
    console.log('\nTest 2: Service-specific query (WhatsApp)');
    const start2 = Date.now();
    const whatsapp = await servicesCollection.find({ service_persian: 'واتساپ' }).explain('executionStats');
    const end2 = Date.now();
    console.log(`   Execution time: ${end2 - start2}ms`);
    console.log(`   Documents examined: ${whatsapp.executionStats.totalDocsExamined}`);
    console.log(`   Documents returned: ${whatsapp.executionStats.nReturned}`);
    console.log(`   Index used: ${whatsapp.executionStats.executionStages.indexName || 'COLLSCAN'}`);

    // Test 3: ID lookup
    console.log('\nTest 3: ID lookup query');
    const sampleDoc = await servicesCollection.findOne({});
    if (sampleDoc) {
      const start3 = Date.now();
      const byId = await servicesCollection.find({ id: sampleDoc.id }).explain('executionStats');
      const end3 = Date.now();
      console.log(`   Execution time: ${end3 - start3}ms`);
      console.log(`   Documents examined: ${byId.executionStats.totalDocsExamined}`);
      console.log(`   Documents returned: ${byId.executionStats.nReturned}`);
      console.log(`   Index used: ${byId.executionStats.executionStages.indexName || 'COLLSCAN'}`);
    }

    console.log('\n✅ Index setup complete!\n');
    console.log('💡 Recommendations:');
    console.log('   - All queries should now use indexes (no COLLSCAN)');
    console.log('   - Featured services query should be < 50ms');
    console.log('   - Service-specific queries should be < 100ms');
    console.log('   - ID lookups should be < 5ms');
    console.log('\n🚀 Your database is now optimized for lazy loading!\n');

  } catch (error) {
    console.error('❌ Error setting up indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
};

// اگر این فایل مستقیماً اجرا شود
if (require.main === module) {
  setupIndexes();
}

module.exports = setupIndexes;
