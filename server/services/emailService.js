import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

export const sendRaceAlertEmail = async (userEmail, raceData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: `🏁 F1 Race Alert: ${raceData.raceName} Starting Soon!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #121212; color: #fff; padding: 20px; border-radius: 8px;">
          <h2 style="color: #E10600;">🏁 Race Alert</h2>
          <p><strong>Race:</strong> ${raceData.raceName}</p>
          <p><strong>Circuit:</strong> ${raceData.circuit}</p>
          <p><strong>Date:</strong> ${raceData.date}</p>
          <p><strong>Time:</strong> ${raceData.time}</p>
          <hr style="border-color: #333;">
          <p>Don't miss the action! Check the live dashboard to follow the race.</p>
          <a href="${process.env.FRONTEND_URL}/live" style="display: inline-block; background: #E10600; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Watch Live</a>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✓ Race alert sent to ${userEmail}`);
  } catch (err) {
    console.error("✗ Email send failed:", err.message);
  }
};

export const sendWatchlistNotificationEmail = async (userEmail, notificationData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: `⏰ F1 Notification: ${notificationData.type}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #121212; color: #fff; padding: 20px; border-radius: 8px;">
          <h2 style="color: #27F4D2;">⏰ Watchlist Alert</h2>
          <p><strong>Event:</strong> ${notificationData.type}</p>
          <p><strong>Details:</strong> ${notificationData.message}</p>
          <hr style="border-color: #333;">
          <p>Head to the app for more details!</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✓ Notification sent to ${userEmail}`);
  } catch (err) {
    console.error("✗ Email send failed:", err.message);
  }
};

export default transporter;
