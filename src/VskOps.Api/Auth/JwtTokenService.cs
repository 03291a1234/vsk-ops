using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using VskOps.Core.Domain;

namespace VskOps.Api.Auth;

public class JwtSettings
{
    public string Issuer { get; set; } = "VskOps";
    public string Audience { get; set; } = "VskOps";
    /// <summary>HMAC signing key — supply via configuration/user-secrets, never commit a real one.</summary>
    public string Key { get; set; } = "";
    public int ExpiryHours { get; set; } = 12;
}

public class JwtTokenService(JwtSettings settings)
{
    public string CreateToken(User user)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(ClaimTypes.Name, user.Name),
            new(ClaimTypes.Role, user.Role),
        };
        if (user.DriverId is { } driverId)
            claims.Add(new Claim("driverId", driverId.ToString()));

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.Key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: settings.Issuer,
            audience: settings.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(settings.ExpiryHours),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
