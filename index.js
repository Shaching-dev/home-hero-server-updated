const express = require("express");
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// console.log(process.env);
const port = process.env.PORT || 3000;
const app = express();

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

app.get("/", (req, res) => {
  res.send("Home hero service running perfectly");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(cors());
app.use(express.json());

const uri = process.env.DB_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("home_hero_db");
    const serviceCollection = db.collection("services");
    const bookingCollection = db.collection("bookings");
    const usersCollection = db.collection("users");
    const providersCollection = db.collection("providers");

    // users related

    app.post("/users", async (req, res) => {
      const user = req.body;
      (user.role = "user"), (user.createdAt = new Date());
      const email = user.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "users alredy exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", verifyToken, async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.get("/users", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "Email is required" });

        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    app.get("/profile", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .send({ message: "Email query parameter is required" });
        }
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (err) {
        console.error("Error fetching profile:", err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // -------------------

    app.patch("/users/:id/role", verifyToken, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };

      const result = await usersCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.post("/providers", async (req, res) => {
      const provider = req.body;
      provider.status = "pending";
      const result = await providersCollection.insertOne(provider);
      res.send(result);
    });

    app.get("/all-request", async (req, res) => {
      const cursor = providersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/all-request/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await providersCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/my-request", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
      }
      const cursor = providersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/my-request/:id", async (req, res) => {
      const id = req.params.id;
      const result = await providersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "cancelled" } }
      );
      res.send(result);
    });

    app.patch("/update-request/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      try {
        const requestResult = await providersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        let userResult = null;

        if (status === "accepted") {
          const request = await providersCollection.findOne({
            _id: new ObjectId(id),
          });
          userResult = await usersCollection.updateOne(
            { email: request.email },
            { $set: { role: "provider" } }
          );
        }

        res.send({ requestResult, userResult });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Something went wrong", error });
      }
    });

    // ------------------------

    app.post("/services", async (req, res) => {
      const service = req.body;
      const result = await serviceCollection.insertOne(service);
      res.send(result);
    });

    // services apis

    app.get("/services", async (req, res) => {
      try {
        const {
          email,
          popular,
          searchText = "",
          sort,

          page = 1,
          limit = 10,
          category,
        } = req.query;
        const query = {};
        if (email) {
          query.providerEmail = email;
        }
        if (searchText) {
          query.$or = [
            { description: { $regex: searchText, $options: "i" } },
            { serviceName: { $regex: searchText, $options: "i" } },
            { category: { $regex: searchText, $options: "i" } },
            { email: { $regex: searchText, $options: "i" } },
            { serviceName: { $regex: searchText, $options: "i" } },
            { price: { $regex: searchText, $options: "i" } },
          ];
        }
        if (category) {
          query.category = { $regex: `^${category}$`, $options: "i" };
        }
        let cursor = serviceCollection.find(query);
        if (popular === "true") {
          cursor = cursor
            .sort({ price: 1 })
            .project({ description: 0 })
            .limit(Number(limit));
        } else {
          if (sort === "priceLow") cursor = cursor.sort({ price: 1 });
          else if (sort === "priceHigh") cursor = cursor.sort({ price: -1 });
          else if (sort === "name") cursor = cursor.sort({ name: 1 });
          else if (sort === "newest") cursor = cursor.sort({ createdAt: -1 });
          else cursor = cursor.sort({ ratings: -1 });
          const skip = (Number(page) - 1) * Number(limit);
          cursor = cursor.skip(skip).limit(Number(limit));
        }
        const services = await cursor.toArray();
        const total = await serviceCollection.countDocuments(query);
        res.send({
          services,
          total,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load services" });
      }
    });

    // -----------------------------

    app.get("/my-services", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.email = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
      }
      const result = await serviceCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/my-services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.findOne(query);
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const newBook = req.body;
      const result = await bookingCollection.insertOne(newBook);
      res.send(result);
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      const cursor = bookingCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/my-bookings", async (req, res) => {
      const email = req.query.email;
      let query = {};
      if (email) {
        query.customerEmail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
      }
      const cursor = bookingCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const cursor = bookingCollection.find().sort({ bookedAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookingCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount > 0) {
          res.send({ success: true });
        } else {
          res.status(404).send({ message: "Booking not found" });
        }
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is ruuning on the port of ${port}`);
});
