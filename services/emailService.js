// services/emailService.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false, // true for 465
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

export const sendEmail = async (to, subject, html) => {
    try {
        const info = await transporter.sendMail({
            from: `"RCCG TOP" <${process.env.EMAIL_FROM}>`,
            to: to,
            subject: subject,
            html: html,
            text: html.replace(/<[^>]*>/g, '')
        });
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Email error:', error);
        return { success: false, error: error.message };
    }
};

// Templates
export const welcomeEmail = (name) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #10b981;">Welcome to RCCG Tabernacle of Praise, ${name}!</h2>
        <p>We are delighted to have you as part of our church family.</p>
        <p>May God bless you abundantly.</p>
        <p>— Pastoral Team</p>
    </div>
`;

export const followUpReminder = (name, note) => `
    <div style="font-family: Arial, sans-serif;">
        <h3>Follow-up Reminder for <strong>${name}</strong></h3>
        <p><strong>Note:</strong> ${note}</p>
        <p>Please reach out to them today.</p>
    </div>
`;