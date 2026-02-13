
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection configuration
const db = mysql.createConnection({
  host: 'sql12.freesqldatabase.com',
  user: 'sql12794562',
  password: 'aZ7fmwm4gU',
  database: 'sql12794562',
  port: 3306
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    return;
  }
  console.log('✅ Connected to MySQL database.');
});

// Ensure user_orders table exists and has correct schema
const createUserOrdersTableSql = `
  CREATE TABLE IF NOT EXISTS user_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    firebaseUserId VARCHAR(255) NOT NULL,
    orderId INT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (orderId) REFERENCES auctions(orderId) ON DELETE CASCADE
  )
`;

db.query(createUserOrdersTableSql, (err) => {
  if (err) {
    console.error('❌ Error creating user_orders table:', err);
  } else {
    console.log('✅ user_orders table ensured');
    // Check if createdAt column exists, and add it if missing
    db.query("SHOW COLUMNS FROM user_orders LIKE 'createdAt'", (err, results) => {
      if (err) {
        console.error('❌ Error checking user_orders columns:', err);
      } else if (results.length === 0) {
        console.log('⚠️ createdAt column missing in user_orders, adding it...');
        db.query(`
          ALTER TABLE user_orders
          ADD COLUMN createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `, (err) => {
          if (err) {
            console.error('❌ Error adding createdAt column:', err);
          } else {
            console.log('✅ createdAt column added to user_orders');
          }
        });
      } else {
        console.log('✅ createdAt column exists in user_orders');
      }
    });
  }
});

// GET route to fetch and log all fields
app.get('/api/auctions', (req, res) => {
  const sql = `
    SELECT 
      orderId, auctionDuration, bids, category, createdAt, currentPrice,
      deliveryLocation, leadingBid, qualitySpecs, quantity, startingBid,
      status, title, unit, urgent
    FROM auctions
  `;
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error fetching data:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    
    console.log('📦 Auction Data:');
    results.forEach((row, index) => {
      console.log(`--- Row ${index + 1} ---`);
      console.log(row);
    });
    
    res.json(results);
  });
});

// GET route to fetch all users with their auction orders
app.get('/api/user-orders', (req, res) => {
  const sql = `
    SELECT 
      u.id AS userOrderId,
      u.firebaseUserId,
      a.orderId,
      a.title,
      a.category,
      a.quantity,
      a.unit,
      a.status,
      a.currentPrice,
      a.leadingBid,
      a.startingBid,
      a.createdAt,
      a.urgent,
      a.deliveryLocation,
      a.qualitySpecs,
      a.auctionDuration
    FROM user_orders u
    JOIN auctions a ON u.orderId = a.orderId
  `;
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ Error fetching user orders:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    
    console.log(`📦 All User Orders`);
    results.forEach((row, index) => {
      console.log(`--- Row ${index + 1} ---`);
      console.log(row);
    });
    
    res.json(results);
  });
});

// POST route to create a new auction
app.post('/api/create-auction', (req, res) => {
  const {
    title,
    category,
    qualitySpecs,
    quantity,
    unit,
    startingBid,
    auctionDuration,
    deliveryLocation,
    urgent,
    firebaseUserId
  } = req.body;

  // Validate required fields
  if (!title || !category || !quantity || !unit || !startingBid || !auctionDuration || !deliveryLocation || !firebaseUserId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Start a transaction
  db.beginTransaction((err) => {
    if (err) {
      console.error('❌ Error starting transaction:', err);
      return res.status(500).json({ error: 'Failed to start transaction' });
    }

    // Insert into auctions table
    const insertAuctionSql = `
      INSERT INTO auctions (
        title, category, qualitySpecs, quantity, unit, startingBid,
        auctionDuration, deliveryLocation, urgent, status, bids, 
        currentPrice, leadingBid, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, NULL, NULL, NOW())
    `;

    const auctionValues = [
      title,
      category,
      qualitySpecs || '',
      quantity,
      unit,
      startingBid,
      auctionDuration,
      deliveryLocation,
      urgent ? 1 : 0
    ];

    db.query(insertAuctionSql, auctionValues, (err, auctionResult) => {
      if (err) {
        console.error('❌ Error creating auction:', err);
        console.error('Error details:', {
          sqlMessage: err.sqlMessage,
          sqlState: err.sqlState,
          errno: err.errno,
          code: err.code
        });
        return db.rollback(() => {
          res.status(500).json({ error: 'Failed to create auction', details: err.sqlMessage });
        });
      }

      const orderId = auctionResult.insertId;
      console.log(`✅ Auction created with ID: ${orderId}`, { auctionResult });

      // Validate orderId
      if (!orderId || orderId === 0) {
        console.error('❌ Invalid orderId:', orderId);
        return db.rollback(() => {
          res.status(500).json({ error: 'Invalid auction ID generated' });
        });
      }

      // Verify auction exists
      db.query('SELECT orderId FROM auctions WHERE orderId = ?', [orderId], (err, auctionCheck) => {
        if (err || auctionCheck.length === 0) {
          console.error('❌ Auction not found after insertion:', err || 'No record');
          return db.rollback(() => {
            res.status(500).json({ error: 'Failed to verify auction' });
          });
        }

        // Insert into user_orders table to link user with auction
        const insertUserOrderSql = `
          INSERT INTO user_orders (firebaseUserId, orderId, createdAt)
          VALUES (?, ?, NOW())
        `;

        db.query(insertUserOrderSql, [firebaseUserId, orderId], (err, userOrderResult) => {
          if (err) {
            console.error('❌ Error linking user to auction:', err);
            console.error('Error details:', {
              sqlMessage: err.sqlMessage,
              sqlState: err.sqlState,
              errno: err.errno,
              code: err.code
            });
            return db.rollback(() => {
              res.status(500).json({ error: 'Failed to link user to auction', details: err.sqlMessage });
            });
          }

          // Commit the transaction
          db.commit((err) => {
            if (err) {
              console.error('❌ Error committing transaction:', err);
              return db.rollback(() => {
                res.status(500).json({ error: 'Failed to commit transaction' });
              });
            }

            console.log(`✅ User linked to auction successfully`, { userOrderId: userOrderResult.insertId });
            res.json({
              success: true,
              message: 'Auction created successfully',
              orderId: orderId,
              userOrderId: userOrderResult.insertId
            });
          });
        });
      });
    });
  });
});

// POST route to stop an auction
app.post('/api/stop-auction', (req, res) => {
  const { orderId, firebaseUserId } = req.body;

  // Validate required fields
  if (!orderId || !firebaseUserId) {
    return res.status(400).json({ error: 'Missing orderId or firebaseUserId' });
  }

  // First, verify that the user owns this auction
  const verifyOwnershipSql = `
    SELECT u.id 
    FROM user_orders u 
    WHERE u.orderId = ? AND u.firebaseUserId = ?
  `;

  db.query(verifyOwnershipSql, [orderId, firebaseUserId], (err, ownershipResults) => {
    if (err) {
      console.error('❌ Error verifying auction ownership:', err);
      return res.status(500).json({ error: 'Failed to verify auction ownership' });
    }

    if (ownershipResults.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to stop this auction' });
    }

    // Update the auction status to 'stopped'
    const updateAuctionSql = `
      UPDATE auctions 
      SET status = 'stopped' 
      WHERE orderId = ?
    `;

    db.query(updateAuctionSql, [orderId], (err, updateResult) => {
      if (err) {
        console.error('❌ Error stopping auction:', err);
        return res.status(500).json({ error: 'Failed to stop auction' });
      }

      if (updateResult.affectedRows === 0) {
        return res.status(404).json({ error: 'Auction not found' });
      }

      console.log(`✅ Auction ${orderId} stopped successfully`);
      res.json({
        success: true,
        message: 'Auction stopped successfully',
        orderId: orderId
      });
    });
  });
});

// POST route to submit a bid
app.post('/api/submit-bid', (req, res) => {
  const {
    auctionId,
    vendorId,
    vendorName,
    price,
    deliveryTime,
    description
  } = req.body;

  // Validate required fields
  if (!auctionId || !vendorId || !price || !deliveryTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // First, check if the auction exists and is active
  const checkAuctionSql = `
    SELECT orderId, status, startingBid 
    FROM auctions 
    WHERE orderId = ?
  `;

  db.query(checkAuctionSql, [auctionId], (err, auctionResults) => {
    if (err) {
      console.error('❌ Error checking auction:', err);
      return res.status(500).json({ error: 'Failed to check auction' });
    }

    if (auctionResults.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    const auction = auctionResults[0];
    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Auction is not active' });
    }

    // Create bids table if it doesn't exist
    const createBidsTableSql = `
      CREATE TABLE IF NOT EXISTS bids (
        id INT AUTO_INCREMENT PRIMARY KEY,
        auctionId INT NOT NULL,
        vendorId VARCHAR(255) NOT NULL,
        vendorName VARCHAR(255),
        price DECIMAL(10, 2) NOT NULL,
        deliveryTime VARCHAR(255),
        description TEXT,
        status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (auctionId) REFERENCES auctions(orderId)
      )
    `;

    db.query(createBidsTableSql, (err) => {
      if (err) {
        console.error('❌ Error creating bids table:', err);
        return res.status(500).json({ error: 'Database setup error' });
      }

      // Insert the bid
      const insertBidSql = `
        INSERT INTO bids (auctionId, vendorId, vendorName, price, deliveryTime, description, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())
      `;

      const bidValues = [
        auctionId,
        vendorId,
        vendorName || 'Anonymous Vendor',
        price,
        deliveryTime,
        description || ''
      ];

      db.query(insertBidSql, bidValues, (err, bidResult) => {
        if (err) {
          console.error('❌ Error submitting bid:', err);
          return res.status(500).json({ error: 'Failed to submit bid' });
        }

        // Update the auction's bid count
        const updateBidCountSql = `
          UPDATE auctions 
          SET bids = bids + 1,
              currentPrice = CASE 
                WHEN currentPrice IS NULL OR ? < currentPrice THEN ?
                ELSE currentPrice 
              END
          WHERE orderId = ?
        `;

        db.query(updateBidCountSql, [price, price, auctionId], (err) => {
          if (err) {
            console.error('❌ Error updating auction bid count:', err);
            // Don't return error here as the bid was successfully created
          }

          console.log(`✅ Bid submitted successfully for auction ${auctionId}`);
          res.json({
            success: true,
            message: 'Bid submitted successfully',
            bidId: bidResult.insertId,
            auctionId: auctionId
          });
        });
      });
    });
  });
});

// GET route to fetch bids for a specific auction
app.get('/api/auction-bids/:auctionId', (req, res) => {
  const { auctionId } = req.params;

  const sql = `
    SELECT 
      id, auctionId, vendorId, vendorName, price, deliveryTime, 
      description, status, createdAt
    FROM bids 
    WHERE auctionId = ? 
    ORDER BY createdAt DESC
  `;

  db.query(sql, [auctionId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching bids:', err);
      return res.status(500).json({ error: 'Failed to fetch bids' });
    }

    console.log(`📦 Fetched ${results.length} bids for auction ${auctionId}`);
    res.json(results);
  });
});
app.get('/api/user-auctions/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT 
      a.orderId,
      a.title,
      a.status,
      a.currentPrice,
      b.myBid,
      b.highestBid,
      b.myBudget,
      b.bidStatus
    FROM auctions a
    LEFT JOIN bids b ON a.orderId = b.orderId AND b.userId = ?
    WHERE a.status = 'open';
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(results);
  });
});

// Route to fetch bid history for a user
app.get('/api/bid-history/:userId', (req, res) => {
  const userId = req.params.userId;

  const sql = `
    SELECT 
      a.title,
      a.category,
      a.status,
      h.myBid,
      h.bidStatus,
      h.submittedAt
    FROM bid_history h
    JOIN auctions a ON h.orderId = a.orderId
    WHERE h.userId = ?
    ORDER BY h.submittedAt DESC;
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(results);
  });
});

// Route to place a bid (insert into bids and bid_history)
app.post('/api/place-bid', (req, res) => {
  const {
    orderId,
    userId,
    myBid,
    highestBid,
    myBudget,
    totalPlayers,
    deadline
  } = req.body;

  const bidStatus = 'PENDING';

  const bidInsert = `INSERT INTO bids (orderId, userId, myBid, highestBid, myBudget, totalPlayers, deadline, bidStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const historyInsert = `INSERT INTO bid_history (orderId, userId, myBid, bidStatus, totalPlayers, deadline) VALUES (?, ?, ?, ?, ?, ?)`;

  db.query(bidInsert, [orderId, userId, myBid, highestBid, myBudget, totalPlayers, deadline, bidStatus], (err) => {
    if (err) return res.status(500).json({ error: 'Insert failed' });

    db.query(historyInsert, [orderId, userId, myBid, bidStatus, totalPlayers, deadline], (err2) => {
      if (err2) return res.status(500).json({ error: 'History insert failed' });
      res.json({ message: 'Bid placed successfully' });
    });
  });
});
// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
