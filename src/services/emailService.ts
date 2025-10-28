import { Resend } from 'resend';

// Validate Resend API Key on startup
if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY environment variable is not set!');
}

const resend = new Resend(process.env.RESEND_API_KEY);

export interface PasswordResetEmailOptions {
  email: string;
  resetLink: string;
  userName?: string;
}

export interface EmailVerificationOptions {
  email: string;
  verificationLink: string;
  userName?: string;
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail({
  email,
  resetLink,
  userName = 'User',
}: PasswordResetEmailOptions) {
  try {
    console.log('Sending password reset email to:', email);
    console.log('From:', process.env.EMAIL_FROM || 'noreply@smartpay.ink');
    console.log('Resend API Key configured:', !!process.env.RESEND_API_KEY);
    console.log('Resend API Key starts with:', process.env.RESEND_API_KEY?.substring(0, 10) + '...');

    const emailPayload = {
      from: process.env.EMAIL_FROM || 'noreply@smartpay.ink',
      to: email,
      subject: 'Reset Your Password',
      html: generatePasswordResetTemplate(resetLink, userName),
    };

    console.log('Email payload (without HTML):', {
      from: emailPayload.from,
      to: emailPayload.to,
      subject: emailPayload.subject,
    });

    const result = await resend.emails.send(emailPayload);

    console.log('Resend API response:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail({
  email,
  verificationLink,
  userName = 'User',
}: EmailVerificationOptions) {
  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@smartpay.ink',
      to: email,
      subject: 'Verify Your Email Address',
      html: generateVerificationTemplate(verificationLink, userName),
    });

    return result;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw error;
  }
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(email: string, userName: string = 'User') {
  try {
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'noreply@smartpay.ink',
      to: email,
      subject: 'Welcome to Newton WhatsApp Gateway',
      html: generateWelcomeTemplate(userName),
    });

    return result;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
}

/**
 * Generate password reset email HTML template
 */
function generatePasswordResetTemplate(resetLink: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        line-height: 1.6;
        color: #333;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        border-radius: 8px 8px 0 0;
        text-align: center;
      }
      .content {
        background: #f9f9f9;
        padding: 30px;
        border: 1px solid #eee;
      }
      .button {
        display: inline-block;
        background: #667eea;
        color: white;
        padding: 12px 30px;
        border-radius: 6px;
        text-decoration: none;
        margin: 20px 0;
        font-weight: bold;
      }
      .button:hover {
        background: #764ba2;
      }
      .footer {
        background: #f0f0f0;
        padding: 20px;
        border-radius: 0 0 8px 8px;
        font-size: 12px;
        text-align: center;
        color: #666;
        border: 1px solid #eee;
        border-top: none;
      }
      .warning {
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        padding: 15px;
        border-radius: 6px;
        margin: 20px 0;
        color: #856404;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Password Reset Request</h1>
      </div>
      <div class="content">
        <p>Hi ${userName},</p>

        <p>We received a request to reset your password. Click the button below to create a new password:</p>

        <center>
          <a href="${resetLink}" class="button">Reset Password</a>
        </center>

        <p>Or copy and paste this link in your browser:</p>
        <p style="word-break: break-all; background: #f0f0f0; padding: 10px; border-radius: 6px; font-size: 12px;">
          ${resetLink}
        </p>

        <div class="warning">
          <strong>⚠️ Security Note:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns about your account security.
        </div>

        <p>If you have any questions, please don't hesitate to contact our support team.</p>

        <p>Best regards,<br>The Newton Team</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Newton WhatsApp Gateway. All rights reserved.</p>
        <p>If you didn't request this email, please ignore it.</p>
      </div>
    </div>
  </body>
</html>
  `.trim();
}

/**
 * Generate email verification template
 */
function generateVerificationTemplate(verificationLink: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        line-height: 1.6;
        color: #333;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        border-radius: 8px 8px 0 0;
        text-align: center;
      }
      .content {
        background: #f9f9f9;
        padding: 30px;
        border: 1px solid #eee;
      }
      .button {
        display: inline-block;
        background: #667eea;
        color: white;
        padding: 12px 30px;
        border-radius: 6px;
        text-decoration: none;
        margin: 20px 0;
        font-weight: bold;
      }
      .button:hover {
        background: #764ba2;
      }
      .footer {
        background: #f0f0f0;
        padding: 20px;
        border-radius: 0 0 8px 8px;
        font-size: 12px;
        text-align: center;
        color: #666;
        border: 1px solid #eee;
        border-top: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Verify Your Email Address</h1>
      </div>
      <div class="content">
        <p>Hi ${userName},</p>

        <p>Thank you for signing up! Please verify your email address by clicking the button below:</p>

        <center>
          <a href="${verificationLink}" class="button">Verify Email</a>
        </center>

        <p>Or copy and paste this link:</p>
        <p style="word-break: break-all; background: #f0f0f0; padding: 10px; border-radius: 6px; font-size: 12px;">
          ${verificationLink}
        </p>

        <p>This link will expire in 24 hours.</p>

        <p>If you didn't create this account, you can safely ignore this email.</p>

        <p>Best regards,<br>The Newton Team</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Newton WhatsApp Gateway. All rights reserved.</p>
      </div>
    </div>
  </body>
</html>
  `.trim();
}

/**
 * Generate welcome email template
 */
function generateWelcomeTemplate(userName: string): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        line-height: 1.6;
        color: #333;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        border-radius: 8px 8px 0 0;
        text-align: center;
      }
      .content {
        background: #f9f9f9;
        padding: 30px;
        border: 1px solid #eee;
      }
      .feature-list {
        list-style: none;
        padding: 0;
      }
      .feature-list li {
        padding: 10px 0;
        padding-left: 30px;
        position: relative;
      }
      .feature-list li:before {
        content: "✓";
        position: absolute;
        left: 0;
        color: #667eea;
        font-weight: bold;
      }
      .button {
        display: inline-block;
        background: #667eea;
        color: white;
        padding: 12px 30px;
        border-radius: 6px;
        text-decoration: none;
        margin: 20px 0;
        font-weight: bold;
      }
      .button:hover {
        background: #764ba2;
      }
      .footer {
        background: #f0f0f0;
        padding: 20px;
        border-radius: 0 0 8px 8px;
        font-size: 12px;
        text-align: center;
        color: #666;
        border: 1px solid #eee;
        border-top: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Welcome to Newton! 🎉</h1>
      </div>
      <div class="content">
        <p>Hi ${userName},</p>

        <p>Welcome to Newton WhatsApp Gateway! We're thrilled to have you on board.</p>

        <p><strong>Here's what you can do:</strong></p>
        <ul class="feature-list">
          <li>Send WhatsApp messages programmatically</li>
          <li>Manage multiple WhatsApp accounts</li>
          <li>Use our REST API with your API key</li>
          <li>Track message delivery and read status</li>
          <li>Organize contacts and groups</li>
        </ul>

        <center>
          <a href="${process.env.APP_URL || 'https://whatsappgateway.in'}/dashboard" class="button">Go to Dashboard</a>
        </center>

        <p><strong>Getting Started:</strong></p>
        <ol>
          <li>Log in to your dashboard</li>
          <li>Connect a WhatsApp account</li>
          <li>Generate an API key</li>
          <li>Start sending messages!</li>
        </ol>

        <p>If you have any questions or need help, feel free to reach out to our support team.</p>

        <p>Best regards,<br>The Newton Team</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Newton WhatsApp Gateway. All rights reserved.</p>
        <p>You're receiving this email because you signed up for Newton.</p>
      </div>
    </div>
  </body>
</html>
  `.trim();
}
