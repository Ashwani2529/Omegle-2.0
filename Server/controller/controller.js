const mongoose = require("mongoose");
var UserDB = require("../model/model");

exports.create = (req, res) => {
  const user = new UserDB({
    active: "yes",
    status: "0",
  });

  user
    .save(user)
    .then((data) => {
      res.send(data._id);
    })
    .catch((err) => {
      res.status(500).send({
        message:
          err.message ||
          "Some error occoured while creating a create operation",
      });
    });
};

exports.leavingUserUpdate = (req, res) => {
  const userid = req.params.id;
  console.log("Leaving userid is: ", userid);

  UserDB.updateOne({ _id: userid }, { $set: { active: "no", status: "0" } })
    .then((data) => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update user with ${userid} Maybe user not found!`,
        });
      } else {
        res.send("1 document updated");
      }
    })
    .catch((err) => {
      res.status(500).send({ message: "Error update user information" });
    });
};
exports.updateOnOtherUserClosing = (req, res) => {
  const userid = req.params.id;
  console.log("Leaving userid is: ", userid);

  UserDB.updateOne({ _id: userid }, { $set: { active: "yes", status: "0" } })
    .then((data) => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update user with ${userid} Maybe user not found!`,
        });
      } else {
        res.send("1 document updated");
      }
    })
    .catch((err) => {
      res.status(500).send({ message: "Error update user information" });
    });
};
exports.newUserUpdate = (req, res) => {
  const userid = req.params.id;
  console.log("Revisited userid is: ", userid);

  UserDB.updateOne({ _id: userid }, { $set: { active: "yes" } })
    .then((data) => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update user with ${userid} Maybe user not found!`,
        });
      } else {
        res.send("1 document updated");
      }
    })
    .catch((err) => {
      res.status(500).send({ message: "Error update user information" });
    });
};
exports.updateOnEngagement = (req, res) => {
  const userid = req.params.id;
  console.log("Revisited userid is: ", userid);

  UserDB.updateOne({ _id: userid }, { $set: { status: "1" } })
    .then((data) => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update user with ${userid} Maybe user not found!`,
        });
      } else {
        res.send("1 document updated");
      }
    })
    .catch((err) => {
      res.status(500).send({ message: "Error update user information" });
    });
};
exports.updateOnNext = (req, res) => {
  const userid = req.params.id;
  console.log("Setting user as available for next chat:", userid);

  UserDB.updateOne(
    { _id: userid }, 
    { $set: { status: "0", active: "yes" } }
  )
    .then((data) => {
      if (!data) {
        res.status(404).send({
          message: `Cannot update user with ${userid} Maybe user not found!`,
        });
      } else {
        console.log("User", userid, "is now available for pairing");
        res.send("User status updated to available");
      }
    })
    .catch((err) => {
      console.error("Error updating user status:", err);
      res.status(500).send({ message: "Error update user information" });
    });
};
exports.remoteUserFind = (req, res) => {
  const omeID = req.body.omeID;
  console.log("Finding remote user for:", omeID);
  
  // First, let's see all available users for debugging
  UserDB.find({ active: "yes", status: "0" })
    .then((allUsers) => {
      console.log("All available users for pairing:", allUsers.map(u => ({ id: u._id, active: u.active, status: u.status })));
      
      // Now run the actual query
      return UserDB.aggregate([
        {
          $match: {
            _id: { $ne: new mongoose.Types.ObjectId(omeID) },
            active: "yes",
            status: "0",
          },
        },
        { $sample: { size: 1 } },
      ])
      .limit(1);
    })
    .then((data) => {
      console.log("Remote users found:", data.length);
      if (data.length > 0) {
        console.log("Returning remote user:", data[0]._id);
      } else {
        console.log("No remote users available for pairing");
      }
      res.send(data);
    })
    .catch((err) => {
      console.error("Error finding remote user:", err);
      res.status(500).send({
        message:
          err.message || "Error occured while retriving user information.",
      });
    });
};
exports.getNextUser = (req, res) => {
  const omeID = req.body.omeID;
  const remoteUser = req.body.remoteUser;
  
  console.log("Getting next user for:", omeID);
  console.log("Previous remote user was:", remoteUser);

  // First, let's see all available users
  UserDB.find({ active: "yes", status: "0" })
    .then((allUsers) => {
      console.log("All available users:", allUsers.map(u => ({ id: u._id.toString(), active: u.active, status: u.status })));
      
      // Only exclude the current user (omeID), allow reconnection to previous remote user
      return UserDB.aggregate([
        {
          $match: {
            _id: { $ne: new mongoose.Types.ObjectId(omeID) },
            active: "yes",
            status: "0",
          },
        },
        { $sample: { size: 1 } },
      ]);
    })
    .then((data) => {
      if (data.length > 0) {
        console.log("Next user query result:", data[0]._id.toString());
      } else {
        console.log("Next user query result: No users found");
      }
      res.send(data);
    })
    .catch((err) => {
      console.error("Error in getNextUser:", err);
      res.status(500).send({
        message:
          err.message || "Error occured while retriving user information.",
      });
    });
};
