import mongoose from "mongoose";

const watchlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  name: {
    type: String,
    default: "My Watchlist"
  },
  drivers: [String], // driver IDs
  teams: [String],   // constructor IDs
  races: [Number],   // race IDs
  notifications: {
    enabled: Boolean,
    raceStart: Boolean,
    qualifyingStart: Boolean,
    practiceStart: Boolean,
    driverIncident: Boolean
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Watchlist = mongoose.model("Watchlist", watchlistSchema);
export default Watchlist;
